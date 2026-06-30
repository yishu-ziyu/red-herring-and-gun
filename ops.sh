#!/usr/bin/env bash
# Red Herring ops helper: local checks, remote deployment, and public probes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MVP_DIR="${ROOT_DIR}/mvp"
SERVER_DIR="${MVP_DIR}/server"

ALIYUN_HOST="${ALIYUN_HOST:-121.89.90.68}"
ALIYUN_USER="${ALIYUN_USER:-root}"
REMOTE_MVP_DIR="${REMOTE_MVP_DIR:-}"
APP_DOMAIN="${APP_DOMAIN:-gun.yishuziyu.cn}"
SSH_TARGET="${ALIYUN_USER}@${ALIYUN_HOST}"

usage() {
  cat <<EOF
Usage:
  ./ops.sh check              Run local tests/builds and local API smoke checks
  ./ops.sh public             Probe public domain/IP without using local proxy
  ./ops.sh aliyun-domain      Probe the domain as if DNS points to the Aliyun server
  ./ops.sh remote             Read-only remote Docker/API status check over SSH
  ./ops.sh deploy --yes       Build locally, upload current mvp, rebuild Docker remotely, verify
  ./ops.sh logs               Show recent remote container logs

Environment overrides:
  ALIYUN_HOST=${ALIYUN_HOST}
  ALIYUN_USER=${ALIYUN_USER}
  REMOTE_MVP_DIR=${REMOTE_MVP_DIR:-auto-detect}
  APP_DOMAIN=${APP_DOMAIN}
EOF
}

section() {
  printf "\n== %s ==\n" "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

probe() {
  local label="$1"
  local url="$2"
  local method="${3:-GET}"
  local tmp
  tmp="$(mktemp)"
  local code rc

  set +e
  if [ "$method" = "HEAD" ]; then
    code="$(curl --noproxy '*' -sS -o "$tmp" -w "%{http_code}" -I --max-time 15 "$url" 2>"${tmp}.err")"
  else
    code="$(curl --noproxy '*' -sS -o "$tmp" -w "%{http_code}" --max-time 15 "$url" 2>"${tmp}.err")"
  fi
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "[$label] HTTP $code $url"
    head -c 300 "$tmp" | tr '\n' ' '
    echo
  else
    echo "[$label] curl failed rc=$rc $url"
    sed -n '1,3p' "${tmp}.err"
  fi

  rm -f "$tmp" "${tmp}.err"
}

probe_resolved() {
  local label="$1"
  local url="$2"
  local host="$3"
  local ip="$4"
  local method="${5:-GET}"
  local tmp
  tmp="$(mktemp)"
  local code rc

  set +e
  if [ "$method" = "HEAD" ]; then
    code="$(curl --noproxy '*' --resolve "${host}:443:${ip}" -sS -o "$tmp" -w "%{http_code}" -I --max-time 15 "$url" 2>"${tmp}.err")"
  else
    code="$(curl --noproxy '*' --resolve "${host}:443:${ip}" -sS -o "$tmp" -w "%{http_code}" --max-time 15 "$url" 2>"${tmp}.err")"
  fi
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    echo "[$label] HTTP $code $url via ${ip}"
    head -c 300 "$tmp" | tr '\n' ' '
    echo
  else
    echo "[$label] curl failed rc=$rc $url via ${ip}"
    sed -n '1,3p' "${tmp}.err"
  fi

  rm -f "$tmp" "${tmp}.err"
}

google_doh_a_json() {
  curl --noproxy '*' -fsS --max-time 15 \
    -H 'accept: application/dns-json' \
    "https://dns.google/resolve?name=${APP_DOMAIN}&type=A"
}

print_doh_summary() {
  local json="$1"
  JSON="$json" node <<'NODE'
const data = JSON.parse(process.env.JSON);
const answers = Array.isArray(data.Answer) ? data.Answer : [];
const cname = answers.filter((a) => a.type === 5).map((a) => a.data).join(" ");
const ips = answers.filter((a) => a.type === 1).map((a) => a.data).join(" ");
console.log(`Google DoH CNAME: ${cname || "(none)"}`);
console.log(`Google DoH A: ${ips || "(none)"}`);
NODE
}

first_doh_ip() {
  local json="$1"
  JSON="$json" node <<'NODE'
const data = JSON.parse(process.env.JSON);
const answer = (Array.isArray(data.Answer) ? data.Answer : []).find((a) => a.type === 1);
if (answer) process.stdout.write(answer.data);
NODE
}

python_https_probe_resolved() {
  local label="$1"
  local path="$2"
  local host="$3"
  local ip="$4"

  LABEL="$label" PATH_TO_GET="$path" HOST="$host" IP="$ip" python3 <<'PY'
import os
import socket
import ssl
import sys

label = os.environ["LABEL"]
path = os.environ["PATH_TO_GET"]
host = os.environ["HOST"]
ip = os.environ["IP"]

try:
    ctx = ssl.create_default_context()
    with socket.create_connection((ip, 443), timeout=15) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as sock:
            req = f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"
            sock.sendall(req.encode("ascii"))
            data = sock.recv(500).decode("latin1", errors="replace")
    status = data.splitlines()[0] if data else "(empty response)"
    print(f"[{label}] {status} https://{host}{path} via {ip}")
except Exception as exc:
    print(f"[{label}] failed https://{host}{path} via {ip}: {exc}", file=sys.stderr)
    sys.exit(1)
PY
}

local_builds() {
  section "Local tests and builds"
  need_cmd npm

  (cd "$MVP_DIR" && npm test)
  (cd "$MVP_DIR" && npm run build)
  (cd "$SERVER_DIR" && npm run build)
}

local_api_smoke() {
  section "Local standalone server smoke"
  local port="${LOCAL_API_PORT:-3010}"
  local log="/tmp/red-herring-server-${port}.log"

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Set LOCAL_API_PORT to another port." >&2
    exit 1
  fi

  (cd "$SERVER_DIR" && PORT="$port" node dist/index.js >"$log" 2>&1 & echo $! >"/tmp/red-herring-server-${port}.pid")
  local pid
  pid="$(cat "/tmp/red-herring-server-${port}.pid")"
  trap 'kill "$pid" >/dev/null 2>&1 || true' RETURN

  for _ in 1 2 3 4 5; do
    if curl -fsS --max-time 3 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  curl -fsS --max-time 5 "http://127.0.0.1:${port}/health"
  echo
  curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/models/list"
  echo
}

public_check() {
  section "Public DNS and HTTP probes"
  need_cmd curl

  if command -v dig >/dev/null 2>&1; then
    echo "System DNS ${APP_DOMAIN}: $(dig +short "$APP_DOMAIN" | tr '\n' ' ')"
  else
    echo "dig not installed; skipping DNS lookup."
  fi

  local doh_json doh_ip
  if doh_json="$(google_doh_a_json 2>/dev/null)"; then
    print_doh_summary "$doh_json"
    doh_ip="$(first_doh_ip "$doh_json")"
  else
    doh_ip=""
    echo "Google DoH lookup failed."
  fi

  if [ -n "$doh_ip" ]; then
    probe_resolved "domain https via DoH IP" "https://${APP_DOMAIN}/" "$APP_DOMAIN" "$doh_ip" HEAD
    probe_resolved "domain models via DoH IP" "https://${APP_DOMAIN}/api/models/list" "$APP_DOMAIN" "$doh_ip"
  fi

  probe "domain https" "https://${APP_DOMAIN}/" HEAD
  probe "domain http" "http://${APP_DOMAIN}/" HEAD
  probe "server health" "http://${ALIYUN_HOST}/health"
  probe "server models" "http://${ALIYUN_HOST}/api/models/list"
}

aliyun_domain_check() {
  section "Aliyun domain takeover probes"
  need_cmd python3

  python_https_probe_resolved "aliyun domain https" "/" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "aliyun domain health" "/health" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "aliyun domain models" "/api/models/list" "$APP_DOMAIN" "$ALIYUN_HOST"
}

remote_check() {
  section "Remote Docker/API status"
  need_cmd ssh

  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$SSH_TARGET" <<EOF
set -euo pipefail
if [ -n "$REMOTE_MVP_DIR" ] && [ -f "$REMOTE_MVP_DIR/docker-compose.yml" ]; then
  APP_DIR="$REMOTE_MVP_DIR"
elif [ -f /opt/red-herring/mvp/docker-compose.yml ]; then
  APP_DIR=/opt/red-herring/mvp
elif [ -f /opt/red-herring/docker-compose.yml ]; then
  APP_DIR=/opt/red-herring
else
  echo "No docker-compose.yml found in /opt/red-herring/mvp or /opt/red-herring"
  exit 1
fi
cd "\$APP_DIR"
echo "-- pwd"
pwd
echo "-- docker compose ps"
docker compose ps
echo "-- container health"
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health || true
echo
echo "-- models endpoint"
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/api/models/list || true
echo
EOF
}

deploy_current_mvp() {
  if [ "${1:-}" != "--yes" ]; then
    echo "This will upload the current local mvp directory and restart the remote Docker service."
    echo "Run: ./ops.sh deploy --yes"
    exit 2
  fi

  local_builds

  section "Pack current mvp"
  need_cmd tar
  need_cmd scp
  need_cmd ssh

  local archive
  archive="/tmp/red-herring-mvp-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar czf "$archive" \
    --exclude='node_modules' \
    --exclude='server/node_modules' \
    --exclude='.git' \
    --exclude='.vercel' \
    --exclude='dist' \
    --exclude='server/dist' \
    --exclude='.agent-memory' \
    --exclude='.superpowers' \
    --exclude='multi-agent-viz-research' \
    --exclude='output' \
    --exclude='output/**' \
    --exclude='screenshots' \
    --exclude='screenshots/**' \
    -C "$MVP_DIR" .
  echo "Archive: $archive"

  section "Upload and rebuild remote Docker"
  local remote_dir
  remote_dir="$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$SSH_TARGET" \
    "if [ -n '$REMOTE_MVP_DIR' ]; then echo '$REMOTE_MVP_DIR'; elif [ -f /opt/red-herring/mvp/docker-compose.yml ]; then echo /opt/red-herring/mvp; else echo /opt/red-herring; fi")"
  echo "Remote dir: $remote_dir"
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "mkdir -p '$remote_dir'"
  scp "$archive" "$SSH_TARGET:/tmp/red-herring-mvp.tar.gz"
  if [ -f "$MVP_DIR/.env.local" ]; then
    scp "$MVP_DIR/.env.local" "$SSH_TARGET:${remote_dir}/.env.local"
  else
    echo "Local .env.local not found; keeping remote env file unchanged."
  fi

  ssh "$SSH_TARGET" <<EOF
set -euo pipefail
cd "$remote_dir"
tar xzf /tmp/red-herring-mvp.tar.gz
rm /tmp/red-herring-mvp.tar.gz
docker compose down
docker compose up -d --build
sleep 5
docker compose ps
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health
echo
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/api/models/list
echo
EOF

  rm -f "$archive"
  public_check
}

remote_logs() {
  need_cmd ssh
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$SSH_TARGET" \
    "if [ -n '$REMOTE_MVP_DIR' ] && [ -f '$REMOTE_MVP_DIR/docker-compose.yml' ]; then cd '$REMOTE_MVP_DIR'; elif [ -f /opt/red-herring/mvp/docker-compose.yml ]; then cd /opt/red-herring/mvp; else cd /opt/red-herring; fi && docker compose logs --tail=120 red-herring-api"
}

case "${1:-}" in
  check)
    local_builds
    local_api_smoke
    ;;
  public)
    public_check
    ;;
  aliyun-domain)
    aliyun_domain_check
    ;;
  remote)
    remote_check
    ;;
  deploy)
    deploy_current_mvp "${2:-}"
    ;;
  logs)
    remote_logs
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac

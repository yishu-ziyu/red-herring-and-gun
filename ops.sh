#!/usr/bin/env bash
# Red Herring ops helper: local checks, remote deployment, and public probes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MVP_DIR="${ROOT_DIR}/mvp"
SERVER_DIR="${MVP_DIR}/server"

ALIYUN_HOST="${ALIYUN_HOST:-}"
ALIYUN_USER="${ALIYUN_USER:-}"
REMOTE_MVP_DIR="${REMOTE_MVP_DIR:-}"
APP_DOMAIN="${APP_DOMAIN:-gun.yishuziyu.cn}"
SSH_TARGET="${ALIYUN_USER}@${ALIYUN_HOST}"

require_aliyun() {
  if [ -z "$ALIYUN_HOST" ] || [ -z "$ALIYUN_USER" ]; then
    echo "Set ALIYUN_HOST and ALIYUN_USER"
    exit 1
  fi
}

usage() {
  cat <<EOF
Usage:
  ./ops.sh check              Run local tests/builds and local API smoke checks
  ./ops.sh public             Probe public domain/IP without using local proxy
  ./ops.sh aliyun-domain      Probe the domain as if DNS points to the Aliyun server
  ./ops.sh remote             Read-only remote Docker/API status check over SSH
  ./ops.sh deploy --yes       Build locally, upload current mvp (including dist/), rebuild Docker, publish /opt/red-herring/dist, apply host nginx, verify
  ./ops.sh rollback --yes     Restore /opt/red-herring/dist.prev and image :prev (no compose down -v)
  ./ops.sh restore-keep --yes Restore dist.keep and image :keep after a rollback drill
  ./ops.sh pack <archive.tgz> Pack the mvp payload (PACK_SRC overrides the tree; tests use this)
  ./ops.sh print-remote-deploy [remote-dir]
                              Print the remote extract/migrate/compose steps (no SSH)
  ./ops.sh print-rollback     Print the remote rollback steps (no SSH)
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

# PACK_SRC overrides the tree that is archived (tests point this at a fixture).
# Frontend dist/ is included. server/dist is not (the image rebuilds it).
# Never globally exclude *.png — that dropped logo.png in 2026-06-15.
pack_mvp_archive() {
  local archive="$1"
  local src="${PACK_SRC:-$MVP_DIR}"
  need_cmd tar

  if [ ! -f "$src/dist/index.html" ]; then
    echo "missing $src/dist/index.html — run npm run build before pack" >&2
    exit 1
  fi
  if [ ! -f "$src/dist/logo.png" ]; then
    echo "missing $src/dist/logo.png — public/logo.png must land in dist/" >&2
    exit 1
  fi

  tar czf "$archive" \
    --exclude='node_modules' \
    --exclude='server/node_modules' \
    --exclude='.git' \
    --exclude='.vercel' \
    --exclude='server/dist' \
    --exclude='.agent-memory' \
    --exclude='server/.data' \
    --exclude='.superpowers' \
    --exclude='multi-agent-viz-research' \
    --exclude='output' \
    --exclude='output/**' \
    --exclude='screenshots' \
    --exclude='screenshots/**' \
    -C "$src" .
  echo "Archive: $archive"
}

# Exact remote steps piped over SSH. Tests dump this; deploy uses the same function.
print_remote_deploy() {
  local remote_dir="${1:-/opt/red-herring}"
  sed "s|__REMOTE_DIR__|${remote_dir}|g" <<'EOF'
set -euo pipefail
APP_DIR="__REMOTE_DIR__"
NGINX_DIST="/opt/red-herring/dist"
MIGRATE_DIR="/tmp/rhg-volume-migrate-$$"

PREV_DIST="/opt/red-herring/dist.prev"
if [ -f "$NGINX_DIST/index.html" ]; then
  rm -rf "$PREV_DIST"
  cp -a "$NGINX_DIST" "$PREV_DIST"
  echo "snapshotted $NGINX_DIST -> $PREV_DIST"
fi
if docker image inspect red-herring-red-herring-api:latest >/dev/null 2>&1; then
  docker tag red-herring-red-herring-api:latest red-herring-red-herring-api:prev
  echo "tagged red-herring-red-herring-api:prev"
fi

cd "$APP_DIR"
tar xzf /tmp/red-herring-mvp.tar.gz
rm -f /tmp/red-herring-mvp.tar.gz

if [ ! -d "$APP_DIR/dist" ] || [ ! -f "$APP_DIR/dist/index.html" ]; then
  echo "pack missing dist/; frontend not in payload" >&2
  exit 1
fi

mkdir -p "$NGINX_DIST"
app_dist="$(cd "$APP_DIR/dist" && pwd)"
nginx_dist="$(cd "$NGINX_DIST" && pwd)"
if [ "$app_dist" != "$nginx_dist" ]; then
  rm -rf "$NGINX_DIST"
  mkdir -p "$NGINX_DIST"
  cp -a "$APP_DIR/dist/." "$NGINX_DIST/"
fi

mkdir -p "$MIGRATE_DIR/data" "$MIGRATE_DIR/memory"
if docker ps -q -f name=red-herring-api | grep -q .; then
  docker cp red-herring-api:/app/server/.data/. "$MIGRATE_DIR/data/" 2>/dev/null || true
  docker cp red-herring-api:/app/server/.agent-memory/. "$MIGRATE_DIR/memory/" 2>/dev/null || true
  echo "-- pre-migration counts"
  echo "cases: $(find "$MIGRATE_DIR/data" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "memory: $(find "$MIGRATE_DIR/memory" -type f 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "-- pre-migration counts"
  echo "cases: 0"
  echo "memory: 0"
  echo "pre-migration empty (no running container)"
fi

docker compose down
docker compose up -d --build
sleep 5

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if docker ps -q -f name=red-herring-api | grep -q .; then
    break
  fi
  sleep 2
done

copy_if_dest_empty() {
  local dest="$1"
  local src="$2"
  local dest_count src_count
  dest_count="$(docker exec red-herring-api sh -c "find $dest -type f 2>/dev/null | wc -l" | tr -d ' ')"
  src_count="$(find "$src" -type f 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${dest_count:-0}" -eq 0 ] && [ "${src_count:-0}" -gt 0 ]; then
    docker cp "$src/." "red-herring-api:$dest/"
    echo "migrated $src_count files into $dest"
  else
    echo "skip migrate $dest (dest=$dest_count src=$src_count)"
  fi
}

copy_if_dest_empty /app/server/.data "$MIGRATE_DIR/data"
copy_if_dest_empty /app/server/.agent-memory "$MIGRATE_DIR/memory"
rm -rf "$MIGRATE_DIR"

docker compose ps
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health
echo
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/api/models/list
echo
EOF
}

print_remote_rollback() {
  cat <<'EOF'
set -euo pipefail
cd /opt/red-herring
PREV_DIST=/opt/red-herring/dist.prev
LIVE_DIST=/opt/red-herring/dist
if [ ! -f "$PREV_DIST/index.html" ]; then
  echo "missing $PREV_DIST/index.html" >&2
  exit 1
fi
if ! docker image inspect red-herring-red-herring-api:prev >/dev/null 2>&1; then
  echo "missing image red-herring-red-herring-api:prev" >&2
  exit 1
fi
rm -rf /opt/red-herring/dist.keep
cp -a "$LIVE_DIST" /opt/red-herring/dist.keep
docker tag red-herring-red-herring-api:latest red-herring-red-herring-api:keep
rm -rf "$LIVE_DIST"
cp -a "$PREV_DIST" "$LIVE_DIST"
docker tag red-herring-red-herring-api:prev red-herring-red-herring-api:latest
docker compose down
docker compose up -d
sleep 5
docker compose ps
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health
echo
EOF
}

print_remote_restore_keep() {
  cat <<'EOF'
set -euo pipefail
cd /opt/red-herring
if [ ! -f /opt/red-herring/dist.keep/index.html ]; then
  echo "missing /opt/red-herring/dist.keep/index.html" >&2
  exit 1
fi
if ! docker image inspect red-herring-red-herring-api:keep >/dev/null 2>&1; then
  echo "missing image red-herring-red-herring-api:keep" >&2
  exit 1
fi
rm -rf /opt/red-herring/dist
cp -a /opt/red-herring/dist.keep /opt/red-herring/dist
docker tag red-herring-red-herring-api:keep red-herring-red-herring-api:latest
docker compose down
docker compose up -d
sleep 5
docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health
echo
EOF
}

rollback_live() {
  require_aliyun
  if [ "${1:-}" != "--yes" ]; then
    echo "This restores dist.prev and image :prev, then docker compose up -d (never -v)."
    echo "Run: ./ops.sh rollback --yes"
    exit 2
  fi
  print_remote_rollback | ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" bash
}

restore_keep() {
  require_aliyun
  if [ "${1:-}" != "--yes" ]; then
    echo "This restores dist.keep and image :keep after a rollback drill."
    echo "Run: ./ops.sh restore-keep --yes"
    exit 2
  fi
  print_remote_restore_keep | ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" bash
}

env_file_is_uploadable() {
  local src="$1"
  [ -f "$src" ] || return 1
  grep -q '^[[:space:]]*[^#[:space:]]' "$src"
}

apply_host_nginx() {
  need_cmd scp
  need_cmd ssh
  scp "${ROOT_DIR}/scripts/configure-aliyun-static-nginx.sh" "$SSH_TARGET:/tmp/configure-aliyun-static-nginx.sh"
  scp "${ROOT_DIR}/scripts/configure-aliyun-ip-api-nginx.sh" "$SSH_TARGET:/tmp/configure-aliyun-ip-api-nginx.sh"
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" \
    "bash /tmp/configure-aliyun-static-nginx.sh && ALIYUN_HOST='$ALIYUN_HOST' bash /tmp/configure-aliyun-ip-api-nginx.sh"
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
  local port="${LOCAL_API_PORT:-}"
  if [ -z "$port" ]; then
    for try in 3010 3011 3012 3013 3014 3015; do
      if ! lsof -tiTCP:"$try" -sTCP:LISTEN >/dev/null 2>&1; then
        port="$try"
        break
      fi
    done
  fi
  if [ -z "$port" ]; then
    echo "No free local API port in 3010-3015. Set LOCAL_API_PORT." >&2
    exit 1
  fi
  local log="/tmp/red-herring-server-${port}.log"
  local entry="dist/index.js"
  if [ -f "$SERVER_DIR/dist/server/src/index.js" ]; then
    entry="dist/server/src/index.js"
  fi

  (cd "$SERVER_DIR" && PORT="$port" node "$entry" >"$log" 2>&1 & echo $! >"/tmp/red-herring-server-${port}.pid")
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
  require_aliyun
  section "Public DNS and HTTP probes"
  need_cmd curl
  need_cmd python3

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

  # Prefer Python TLS probes for the Aliyun domain: macOS LibreSSL curl often
  # fails with SSL_ERROR_SYSCALL even when browsers and OpenSSL succeed.
  python_https_probe_resolved "domain https via Aliyun IP" "/" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "domain health via Aliyun IP" "/health" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "domain models via Aliyun IP" "/api/models/list" "$APP_DOMAIN" "$ALIYUN_HOST"

  if [ -n "$doh_ip" ] && [ "$doh_ip" != "$ALIYUN_HOST" ]; then
    python_https_probe_resolved "domain https via DoH IP" "/" "$APP_DOMAIN" "$doh_ip"
    python_https_probe_resolved "domain models via DoH IP" "/api/models/list" "$APP_DOMAIN" "$doh_ip"
  fi

  # HTTP domain may hit Aliyun ICP block; IP /health + /api are the reliable ops paths.
  probe "domain http (may be ICP-blocked)" "http://${APP_DOMAIN}/" HEAD
  probe "server health via IP" "http://${ALIYUN_HOST}/health"
  probe "server models via IP" "http://${ALIYUN_HOST}/api/models/list"
}

aliyun_domain_check() {
  require_aliyun
  section "Aliyun domain takeover probes"
  need_cmd python3

  python_https_probe_resolved "aliyun domain https" "/" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "aliyun domain health" "/health" "$APP_DOMAIN" "$ALIYUN_HOST"
  python_https_probe_resolved "aliyun domain models" "/api/models/list" "$APP_DOMAIN" "$ALIYUN_HOST"
}

remote_check() {
  require_aliyun
  section "Remote Docker/API status"
  need_cmd ssh

  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" <<EOF
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
  require_aliyun
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
  pack_mvp_archive "$archive"

  section "Upload and rebuild remote Docker"
  local remote_dir
  remote_dir="$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" \
    "if [ -n '$REMOTE_MVP_DIR' ]; then echo '$REMOTE_MVP_DIR'; elif [ -f /opt/red-herring/mvp/docker-compose.yml ]; then echo /opt/red-herring/mvp; else echo /opt/red-herring; fi")"
  echo "Remote dir: $remote_dir"
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" "mkdir -p '$remote_dir'"
  scp "$archive" "$SSH_TARGET:/tmp/red-herring-mvp.tar.gz"
  if env_file_is_uploadable "$MVP_DIR/.env.local"; then
    scp "$MVP_DIR/.env.local" "$SSH_TARGET:${remote_dir}/.env.local"
  elif [ -f "$MVP_DIR/.env.local" ]; then
    echo "Local .env.local is empty; not overwriting remote env."
  else
    echo "Local .env.local not found; keeping remote env file unchanged."
  fi

  print_remote_deploy "$remote_dir" | ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" bash

  section "Apply host nginx (SSE unbuffered + /r/)"
  apply_host_nginx

  rm -f "$archive"
  public_check
}

remote_logs() {
  require_aliyun
  need_cmd ssh
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$SSH_TARGET" \
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
  pack)
    if [ -z "${2:-}" ]; then
      echo "Usage: ./ops.sh pack <archive.tgz>" >&2
      exit 2
    fi
    pack_mvp_archive "$2"
    ;;
  print-remote-deploy)
    print_remote_deploy "${2:-/opt/red-herring}"
    ;;
  print-rollback)
    print_remote_rollback
    ;;
  deploy)
    deploy_current_mvp "${2:-}"
    ;;
  rollback)
    rollback_live "${2:-}"
    ;;
  restore-keep)
    restore_keep "${2:-}"
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

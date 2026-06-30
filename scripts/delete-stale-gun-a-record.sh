#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-yishuziyu.cn}"
RR="${RR:-gun}"
STALE_TYPE="${STALE_TYPE:-A}"
STALE_VALUE="${STALE_VALUE:-76.76.21.21}"
PROFILE="${ALIYUN_PROFILE:-dnsfix}"
REGION="${ALIYUN_REGION:-cn-hangzhou}"

if ! command -v aliyun >/dev/null 2>&1; then
  echo "aliyun CLI not found. Run this script on the Aliyun server or install aliyun-cli locally." >&2
  exit 1
fi

if ! aliyun configure list 2>/dev/null | awk -v profile="$PROFILE" '$1 == profile { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "No valid aliyun profile '$PROFILE' found."
  echo "Configure a temporary DNS-only AccessKey now. Input is not echoed."
  read -r -p "AccessKeyId: " ACCESS_KEY_ID
  read -r -s -p "AccessKeySecret: " ACCESS_KEY_SECRET
  echo
  aliyun configure set \
    --profile "$PROFILE" \
    --mode AK \
    --region "$REGION" \
    --access-key-id "$ACCESS_KEY_ID" \
    --access-key-secret "$ACCESS_KEY_SECRET"
fi

TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

aliyun alidns DescribeDomainRecords \
  --profile "$PROFILE" \
  --RegionId "$REGION" \
  --DomainName "$DOMAIN" \
  --RRKeyWord "$RR" \
  --TypeKeyWord "$STALE_TYPE" \
  > "$TMP_JSON"

MATCHES="$(node - "$TMP_JSON" "$RR" "$STALE_TYPE" "$STALE_VALUE" <<'NODE'
const fs = require("fs");
const [path, rr, type, value] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const records = data?.DomainRecords?.Record || data?.Records?.Record || data?.Record || [];
const matches = records.filter((record) =>
  record.RR === rr &&
  record.Type === type &&
  record.Value === value
);
for (const record of matches) {
  console.log([record.RecordId, record.RR, record.Type, record.Value, record.Status, record.TTL].join("\t"));
}
NODE
)"

if [[ -z "$MATCHES" ]]; then
  echo "No exact stale record found: ${RR}.${DOMAIN} ${STALE_TYPE} ${STALE_VALUE}"
  echo
  echo "Current authoritative DNS:"
  dig @dns19.hichina.com "${RR}.${DOMAIN}" A +norecurse +noall +answer +ttlid || true
  dig @dns19.hichina.com "${RR}.${DOMAIN}" CNAME +norecurse +noall +answer +ttlid || true
  exit 0
fi

COUNT="$(printf "%s\n" "$MATCHES" | wc -l | tr -d ' ')"
echo "Exact stale record match(es):"
printf "%s\n" "$MATCHES" | awk -F '\t' '{printf "RecordId=%s RR=%s Type=%s Value=%s Status=%s TTL=%s\n",$1,$2,$3,$4,$5,$6}'

if [[ "$COUNT" != "1" ]]; then
  echo "Refusing to delete because ${COUNT} matching records were found." >&2
  exit 1
fi

RECORD_ID="$(printf "%s\n" "$MATCHES" | awk -F '\t' '{print $1}')"
read -r -p "Delete this exact stale A record? Type DELETE to continue: " CONFIRM
if [[ "$CONFIRM" != "DELETE" ]]; then
  echo "Cancelled."
  exit 1
fi

aliyun alidns DeleteDomainRecord \
  --profile "$PROFILE" \
  --RegionId "$REGION" \
  --RecordId "$RECORD_ID"

echo
echo "Deleted RecordId=$RECORD_ID"
echo
echo "Authoritative DNS after deletion:"
dig @dns19.hichina.com "${RR}.${DOMAIN}" A +norecurse +noall +answer +ttlid || true
dig @dns19.hichina.com "${RR}.${DOMAIN}" CNAME +norecurse +noall +answer +ttlid || true

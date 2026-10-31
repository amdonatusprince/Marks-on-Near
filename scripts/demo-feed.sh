#!/usr/bin/env bash
# Read public prices and store them on the demo oracle.
# A failed fetch stops the script. It does not invent a price.
#   ./scripts/demo-feed.sh

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
load_testnet
require_demo

DIR="$(mktemp -d "${TMPDIR:-/tmp}/marks-feed.XXXXXX")"
python3 "${ROOT}/scripts/demo_feed.py" "${DIR}"

for FILE in "${DIR}"/*.json; do
  ASSET="$(basename "${FILE}" .json)"
  echo "Storing ${ASSET}"
  run near_call "${DEMO_ORACLE_ID}" set_series "${FILE}" "${DEMO_ORACLE_ID}" "0 NEAR" "80 Tgas"
  show_tx "${LAST}"
  run near_view "${DEMO_ORACLE_ID}" get_price "{\"asset_id\":\"${ASSET}\"}"
  echo "Stored multiplier $(field "${LAST}" multiplier)"
done

echo "Feed: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"

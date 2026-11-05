#!/usr/bin/env bash
# Read public prices and store them on the v2 oracle. A failed fetch stops
# the script; it never invents a price.
#   ./scripts/v2-feed.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

DIR="$(mktemp -d "${TMPDIR:-/tmp}/marks-v2-feed.XXXXXX")"
python3 "${ROOT}/scripts/demo_feed.py" "${DIR}"

for FILE in "${DIR}"/*.json; do
  ASSET="$(basename "${FILE}" .json)"
  echo "Storing ${ASSET}"
  run near_call "${V2_ORACLE_ID}" set_series "${FILE}" "${V2_ORACLE_ID}" "0 NEAR" "80 Tgas"
  show_tx "${LAST}"
done

echo "Feed: https://testnet.nearblocks.io/address/${V2_ORACLE_ID}"

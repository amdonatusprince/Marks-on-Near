#!/usr/bin/env bash
# Create the demo feed and the twelve markets, then trade about 300 USDC
# on each. This writes account ids into .env. It does not
# run create-accounts.sh and it does not replace the original market.
#
#   ./scripts/demo.sh
#   ./scripts/demo.sh --from-feed
#   ./scripts/demo.sh --from-list
#   ./scripts/demo.sh --from-trade

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"

FROM="${1:-}"

if [[ "${FROM}" != "--from-feed" && "${FROM}" != "--from-list" && "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-accounts.sh"
  "${ROOT}/scripts/demo-oracle.sh"
fi

if [[ "${FROM}" != "--from-list" && "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-feed.sh"
fi

if [[ "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-list.sh"
fi

"${ROOT}/scripts/demo-trade.sh"

load_testnet
env_set VITE_CONTRACT_ID "${DEMO_CONTRACT_ID}"
env_set VITE_ORACLE_ID "${DEMO_ORACLE_ID}"
env_set VITE_INTENTS_RECIPIENT "${VITE_INTENTS_RECIPIENT:-marks.near}"

echo "Board env points at ${DEMO_CONTRACT_ID}"
echo "Oracle: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"
echo "Marks: https://testnet.nearblocks.io/address/${DEMO_CONTRACT_ID}"

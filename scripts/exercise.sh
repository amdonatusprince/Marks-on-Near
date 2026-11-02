#!/usr/bin/env bash
# Read the deployed market. This does not place, cancel, or move collateral.
# The state-changing sequence is scripts/e2e.sh.
#
#   ./scripts/exercise.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_testnet

echo "Markets"
near_view "${CONTRACT_ID}" get_markets '{}'

echo "Market ${SYMBOL}"
near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}"

echo "Funding rate"
near_view "${CONTRACT_ID}" get_funding_rate_bps "{\"symbol\":\"${SYMBOL}\"}"

echo "Book"
near_view "${CONTRACT_ID}" get_l2 "{\"symbol\":\"${SYMBOL}\",\"depth\":5}"

echo "Account: https://testnet.nearblocks.io/address/${CONTRACT_ID}"

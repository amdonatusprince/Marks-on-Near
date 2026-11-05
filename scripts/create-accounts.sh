#!/usr/bin/env bash
# Create the next contract account and the next collateral-token account,
# then set those ids in .env so deploy.sh can use them. Other keys stay.
#
#   ./scripts/create-accounts.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"

SUFFIX="$(openssl rand -hex 3)"
CONTRACT_ID="marks-${SUFFIX}.testnet"
COLLATERAL_ID="usdc-${SUFFIX}.testnet"
TRADER_ID="trader-${SUFFIX}.testnet"
TAKER_ID="taker-${SUFFIX}.testnet"
AGENT_ID="agent-${SUFFIX}.testnet"

echo "Contract account:   ${CONTRACT_ID}"
echo "Collateral account: ${COLLATERAL_ID}"
echo "Trader account:     ${TRADER_ID}"
echo "Taker account:      ${TAKER_ID}"
echo "Agent account:      ${AGENT_ID}"

"$(dirname "$0")/create-account.sh" "${CONTRACT_ID}"
"$(dirname "$0")/create-account.sh" "${COLLATERAL_ID}"
"$(dirname "$0")/create-account.sh" "${TRADER_ID}"
"$(dirname "$0")/create-account.sh" "${TAKER_ID}"
"$(dirname "$0")/create-account.sh" "${AGENT_ID}"

env_set CONTRACT_ID "${CONTRACT_ID}"
env_set COLLATERAL_ID "${COLLATERAL_ID}"
env_set TRADER_ID "${TRADER_ID}"
env_set TAKER_ID "${TAKER_ID}"
env_set AGENT_ID "${AGENT_ID}"
env_set ORACLE_ID "price-oracle.testnet"
env_set SYMBOL "NEAR-PERP"
env_set CATEGORY "crypto"
env_set TICK_SIZE "1000000"
env_set INITIAL_MARGIN_BPS "1000"
env_set MAINTENANCE_MARGIN_BPS "500"
env_set MAX_FUNDING_BPS "50"
env_set FUNDING_INTERVAL_NS "10000000000"
env_set STALE_AFTER_NS "120000000000"
env_set INSURANCE "1000000"

echo "Updated ${ENV_FILE}"
echo "Next: ./scripts/deploy.sh"

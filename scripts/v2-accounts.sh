#!/usr/bin/env bash
# Create the v2 accounts: mock USDC, the oracle, Marks v2, and six traders.
# Writes the v2 accounts into .env. The contract, oracle and token use the
# same VITE_* names as the app. Nothing else in the file changes.
#   ./scripts/v2-accounts.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet

if [[ -n "${V2_CONTRACT_ID:-}" ]]; then
  echo "v2 accounts are already in .env"
  echo "Marks v2: https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"
  exit 0
fi

SUFFIX="$(python3 -c 'import secrets; print(secrets.token_hex(3))')"
TOKEN="musdc-${SUFFIX}.testnet"
ORACLE="oracle2-${SUFFIX}.testnet"
MARKS="marks2-${SUFFIX}.testnet"
TRADERS=()
for N in 1 2 3 4 5 6; do
  TRADERS+=("t${N}-${SUFFIX}.testnet")
done

for ACCOUNT in "${TOKEN}" "${ORACLE}" "${MARKS}" "${TRADERS[@]}"; do
  "${ROOT}/scripts/create-account.sh" "${ACCOUNT}"
  sleep 2
done

# The Marks wasm needs about 7.3 NEAR of storage. Two traders send it 4 NEAR each.
for FROM in "${TRADERS[4]}" "${TRADERS[5]}"; do
  near_exec tokens "${FROM}" send-near "${MARKS}" '4 NEAR' \
    network-config testnet sign-with-keychain send
done

JOINED="$(IFS=,; echo "${TRADERS[*]}")"
env_set VITE_TOKEN_ID "${TOKEN}"
env_set VITE_ORACLE_ID "${ORACLE}"
env_set VITE_CONTRACT_ID "${MARKS}"
env_set V2_TRADERS "${JOINED}"

echo "Wrote the v2 accounts to .env"

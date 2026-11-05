#!/usr/bin/env bash
# Create the v2 accounts: mock USDC, the oracle, Marks v2, and six traders.
# Appends V2_* lines to scripts/testnet.env. Nothing above them changes.
#   ./scripts/v2-accounts.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet

if [[ -n "${V2_CONTRACT_ID:-}" ]]; then
  echo "v2 accounts are already in scripts/testnet.env"
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
cat >> "${ENV_FILE}" <<EOF

# Marks v2. Appended by scripts/v2-accounts.sh. Everything above stays live.
V2_TOKEN_ID=${TOKEN}
V2_ORACLE_ID=${ORACLE}
V2_CONTRACT_ID=${MARKS}
V2_FEE_ID=${MARKS}
V2_TRADERS=${JOINED}
EOF

echo "Appended the v2 accounts to scripts/testnet.env"

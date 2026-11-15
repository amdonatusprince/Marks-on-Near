#!/usr/bin/env bash
# Create the demo oracle account and the demo Marks account, then append
# their ids to .env. This does not replace that file and it
# does not run create-accounts.sh. The original NEAR-PERP market stays on
# CONTRACT_ID.

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
load_testnet

if [[ -n "${DEMO_CONTRACT_ID:-}" && -n "${DEMO_ORACLE_ID:-}" ]]; then
  echo "Demo accounts are already in .env"
  echo "Oracle: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"
  echo "Marks: https://testnet.nearblocks.io/address/${DEMO_CONTRACT_ID}"
  exit 0
fi

SUFFIX="$(python3 -c 'import secrets; print(secrets.token_hex(3))')"
ORACLE_ACCOUNT="oracle-${SUFFIX}.testnet"
MARKS_ACCOUNT="marks-${SUFFIX}.testnet"

"${ROOT}/scripts/create-account.sh" "${ORACLE_ACCOUNT}"
"${ROOT}/scripts/create-account.sh" "${MARKS_ACCOUNT}"

env_set DEMO_CONTRACT_ID "${MARKS_ACCOUNT}"
env_set DEMO_ORACLE_ID "${ORACLE_ACCOUNT}"
env_set DEMO_TICK_SIZE "10000"
env_set DEMO_STALE_AFTER_NS "3600000000000"

echo "Wrote ${MARKS_ACCOUNT} and ${ORACLE_ACCOUNT} to .env"

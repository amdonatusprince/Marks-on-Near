#!/usr/bin/env bash
# Build the demo oracle and deploy it. new() can succeed once.
#   ./scripts/demo-oracle.sh

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
load_testnet
require_demo

WASM="${ROOT}/oracle/target/wasm32-unknown-unknown/release/marks_oracle.wasm"

set +e
CHECK="$(near_view "${DEMO_ORACLE_ID}" get_history '{"asset_id":"near"}' 2>&1)"
STATUS=$?
set -e
if [[ "${STATUS}" -eq 0 && "${1:-}" != "--upgrade" ]]; then
  echo "Oracle is already deployed at ${DEMO_ORACLE_ID}"
  exit 0
fi
if [[ "${STATUS}" -ne 0 ]]; then
  echo "Oracle is not deployed yet"
  printf '%s\n' "${CHECK}"
fi

echo "Building the oracle wasm"
cargo build --manifest-path "${ROOT}/oracle/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release

if [[ ! -f "${WASM}" ]]; then
  echo "Wasm was not produced at ${WASM}" >&2
  exit 1
fi

if [[ "${1:-}" == "--upgrade" ]]; then
  echo "Upgrading ${DEMO_ORACLE_ID} without calling new()"
  near_exec contract deploy "${DEMO_ORACLE_ID}" \
    use-file "${WASM}" \
    without-init-call \
    network-config testnet \
    sign-with-keychain \
    send
  echo "Oracle: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"
  exit 0
fi

INIT_JSON="$(mktemp "${TMPDIR:-/tmp}/marks-oracle-init.XXXXXX")"
cat > "${INIT_JSON}" <<EOF
{"owner":"${DEMO_ORACLE_ID}"}
EOF

echo "Deploying ${DEMO_ORACLE_ID}"
near_exec contract deploy "${DEMO_ORACLE_ID}" \
  use-file "${WASM}" \
  with-init-call new file-args "${INIT_JSON}" \
  prepaid-gas '100 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send

echo "Oracle: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"

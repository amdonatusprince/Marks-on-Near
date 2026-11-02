#!/usr/bin/env bash
# Build the wasm and deploy it to the contract account in scripts/testnet.env.
#
# First deploy, which also calls new():
#   ./scripts/deploy.sh
#
# Later code update, leaving storage in place:
#   ./scripts/deploy.sh --upgrade

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_testnet

MODE="init"
if [[ "${1:-}" == "--upgrade" ]]; then
  MODE="upgrade"
elif [[ -n "${1:-}" ]]; then
  echo "Usage: ./scripts/deploy.sh [--upgrade]" >&2
  exit 1
fi

echo "Building wasm"
cargo build --manifest-path "${ROOT}/contract/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release

if [[ ! -f "${WASM}" ]]; then
  echo "Wasm was not produced at ${WASM}" >&2
  exit 1
fi

if [[ "${MODE}" == "upgrade" ]]; then
  echo "Upgrading ${CONTRACT_ID} without calling new()"
  near_exec contract deploy "${CONTRACT_ID}" \
    use-file "${WASM}" \
    without-init-call \
    network-config testnet \
    sign-with-keychain \
    send
  exit 0
fi

INIT_JSON="$(mktemp "${TMPDIR:-/tmp}/marks-init.XXXXXX")"
cat > "${INIT_JSON}" <<EOF
{
  "collateral_token": "${COLLATERAL_ID}",
  "oracle": "${ORACLE_ID}"
}
EOF

echo "Deploying ${WASM} to ${CONTRACT_ID} and calling new()"
echo "Init args: ${INIT_JSON}"
near_exec contract deploy "${CONTRACT_ID}" \
  use-file "${WASM}" \
  with-init-call new file-args "${INIT_JSON}" \
  prepaid-gas '300 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send

echo "Contract: https://testnet.nearblocks.io/address/${CONTRACT_ID}"
echo "A new() deploy can only succeed once on an account. Later deploys use ./scripts/deploy.sh --upgrade"

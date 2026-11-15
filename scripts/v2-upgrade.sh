#!/usr/bin/env bash
# Replace the Marks v2 code and leave every gift, position and balance in place.
#   ./scripts/v2-upgrade.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

echo "Building Marks v2"
cargo build --manifest-path "${ROOT}/contract/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --release

WASM="${ROOT}/contract/target/wasm32-unknown-unknown/release/marks.wasm"
if [[ ! -f "${WASM}" ]]; then
  echo "Wasm was not produced at ${WASM}" >&2
  exit 1
fi

echo "Upgrading ${V2_CONTRACT_ID} without calling new()"
near_exec contract deploy "${V2_CONTRACT_ID}" \
  use-file "${WASM}" \
  without-init-call \
  network-config "${NETWORK}" \
  sign-with-keychain \
  send

echo "Marks v2: https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"

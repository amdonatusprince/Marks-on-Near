#!/usr/bin/env bash
# Create one testnet account. The faucet pays for it and the key is saved
# in the near-cli keychain.
#
#   ./scripts/create-account.sh my-name.testnet

set -euo pipefail
source "$(dirname "$0")/lib.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: ./scripts/create-account.sh <account.testnet>" >&2
  exit 1
fi

ACCOUNT_ID="$1"
echo "Creating ${ACCOUNT_ID} on testnet"
near_exec account create-account \
  sponsor-by-faucet-service "${ACCOUNT_ID}" \
  autogenerate-new-keypair \
  save-to-keychain \
  network-config testnet \
  create
echo "Created ${ACCOUNT_ID}"
echo "https://testnet.nearblocks.io/address/${ACCOUNT_ID}"

#!/usr/bin/env bash
# Build and deploy mock USDC, the oracle, and Marks v2 to the v2 accounts.
# An account that already answers a view keeps its code.
#   ./scripts/v2-deploy.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

deploy() {
  local account="$1" wasm="$2" init="$3"
  local file
  file="$(args_file "${init}")"
  echo "Deploying ${account}"
  run near_exec contract deploy "${account}" \
    use-file "${wasm}" \
    with-init-call new file-args "${file}" \
    prepaid-gas '100 Tgas' \
    attached-deposit '0 NEAR' \
    network-config testnet \
    sign-with-keychain \
    send
  show_tx "${LAST}"
}

for CRATE in token oracle contract; do
  cargo build --manifest-path "${ROOT}/${CRATE}/Cargo.toml" --target wasm32-unknown-unknown --release
done

if has_code "${V2_TOKEN_ID}" ft_metadata; then
  echo "${V2_TOKEN_ID} already has code"
else
  deploy "${V2_TOKEN_ID}" "${ROOT}/token/target/wasm32-unknown-unknown/release/marks_token.wasm" \
    "{\"owner_id\":\"${V2_TOKEN_ID}\"}"
fi

if has_code "${V2_ORACLE_ID}" get_history '{"asset_id":"near"}'; then
  echo "${V2_ORACLE_ID} already has code"
else
  deploy "${V2_ORACLE_ID}" "${ROOT}/oracle/target/wasm32-unknown-unknown/release/marks_oracle.wasm" \
    "{\"owner\":\"${V2_ORACLE_ID}\"}"
fi

if has_code "${V2_CONTRACT_ID}" get_markets; then
  echo "${V2_CONTRACT_ID} already has code"
else
  deploy "${V2_CONTRACT_ID}" "${ROOT}/contract/target/wasm32-unknown-unknown/release/marks.wasm" \
    "{\"collateral_token\":\"${V2_TOKEN_ID}\",\"oracle\":\"${V2_ORACLE_ID}\",\"fee_account\":\"${V2_FEE_ID}\"}"
fi

echo "Mock USDC: https://testnet.nearblocks.io/address/${V2_TOKEN_ID}"
echo "Oracle: https://testnet.nearblocks.io/address/${V2_ORACLE_ID}"
echo "Marks v2: https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"

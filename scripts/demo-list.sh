#!/usr/bin/env bash
# Deploy a new Marks contract pointed at the demo oracle and list the
# twelve markets. Insurance is 0. A mark older than one hour blocks new risk.
#   ./scripts/demo-list.sh

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
load_testnet
require_demo

TICK="${DEMO_TICK_SIZE:-10000}"
STALE="${DEMO_STALE_AFTER_NS:-3600000000000}"
INTERVAL="${FUNDING_INTERVAL_NS}"
WASM="${ROOT}/contract/target/wasm32-unknown-unknown/release/marks.wasm"

set +e
CHECK="$(near_view "${DEMO_CONTRACT_ID}" get_markets '{}' 2>&1)"
STATUS=$?
set -e
if [[ "${STATUS}" -eq 0 ]]; then
  echo "Marks is already deployed at ${DEMO_CONTRACT_ID}"
else
  echo "Building Marks"
  cargo build --manifest-path "${ROOT}/contract/Cargo.toml" \
    --target wasm32-unknown-unknown \
    --release
  INIT_JSON="$(mktemp "${TMPDIR:-/tmp}/marks-demo-init.XXXXXX")"
  cat > "${INIT_JSON}" <<EOF
{"collateral_token":"${COLLATERAL_ID}","oracle":"${DEMO_ORACLE_ID}"}
EOF
  echo "Deploying ${DEMO_CONTRACT_ID}"
  near_exec contract deploy "${DEMO_CONTRACT_ID}" \
    use-file "${WASM}" \
    with-init-call new file-args "${INIT_JSON}" \
    prepaid-gas '300 Tgas' \
    attached-deposit '0 NEAR' \
    network-config testnet \
    sign-with-keychain \
    send
fi

while read -r SYMBOL CATEGORY ASSET; do
  [[ -z "${SYMBOL}" ]] && continue
  set +e
  MARKET="$(near_view "${DEMO_CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}" 2>&1)"
  STATUS=$?
  set -e
  if [[ "${STATUS}" -ne 0 ]]; then
    echo "Listing ${SYMBOL}"
    run near_call "${DEMO_CONTRACT_ID}" create_market "{\"symbol\":\"${SYMBOL}\",\"category\":\"${CATEGORY}\",\"tick_size\":\"${TICK}\",\"initial_margin_bps\":${INITIAL_MARGIN_BPS},\"maintenance_margin_bps\":${MAINTENANCE_MARGIN_BPS},\"max_funding_bps\":${MAX_FUNDING_BPS},\"funding_interval_ns\":${INTERVAL},\"asset_id\":\"${ASSET}\",\"stale_after_ns\":${STALE},\"insurance\":\"0\",\"custom_request\":null}" "${TRADER_ID}"
    show_tx "${LAST}"
  else
    echo "${SYMBOL} is already listed"
  fi

  MARK=0
  for _ in 1 2 3; do
    echo "Refreshing ${SYMBOL}"
    run near_call "${DEMO_CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${DEMO_CONTRACT_ID}" "0.02 NEAR" "300 Tgas"
    show_tx "${LAST}"
    run near_view "${DEMO_CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}"
    MARKET="${LAST}"
    MARK="$(field "${MARKET}" mark_ticks)"
    echo "${SYMBOL} mark ticks: ${MARK}"
    if [[ "${MARK}" != "0" ]]; then
      break
    fi
    sleep 5
  done
  if [[ "${MARK}" == "0" ]]; then
    echo "${SYMBOL} still has no mark" >&2
    exit 1
  fi
done < <(demo_markets)

echo "Board contract: https://testnet.nearblocks.io/address/${DEMO_CONTRACT_ID}"

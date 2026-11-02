#!/usr/bin/env bash
# Fresh testnet accounts, then every public method in order.
# A wrong result stops the script.
#
#   ./scripts/e2e.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${ROOT}/scripts/json_get.py"

MINT=60000000
COMMIT=50000000
WITHDRAW=10000000
LOTS=1

step() {
  echo
  echo "=== $1 ==="
}

show_tx() {
  local output="$1"
  local hash
  hash="$(printf '%s\n' "${output}" | grep -o 'Transaction ID: [A-Za-z0-9]*' | tail -1 | awk '{print $3}' || true)"
  if [[ -n "${hash}" ]]; then
    echo "Nearblocks: https://testnet.nearblocks.io/txns/${hash}"
  else
    echo "No transaction id in the command output"
  fi
}

field() {
  printf '%s\n' "$1" | python3 "${PY}" "$2"
}

expect() {
  local label="$1"
  local actual="$2"
  local wanted="$3"
  if [[ "${actual}" != "${wanted}" ]]; then
    echo "${label}: got ${actual}, wanted ${wanted}" >&2
    exit 1
  fi
  echo "${label}: ${actual}"
}

if [[ "${1:-}" == "--continue" || "${1:-}" == "--from-deposit" || "${1:-}" == "--from-list" || "${1:-}" == "--from-trade" || "${1:-}" == "--from-cross" || "${1:-}" == "--from-fill" || "${1:-}" == "--from-funding" || "${1:-}" == "--from-flatten" ]]; then
  step "Continuing with the accounts already in scripts/testnet.env"
  load_testnet
else
  step "Accounts"
  "${ROOT}/scripts/create-accounts.sh"
  load_testnet
fi
: "${TRADER_ID:?}"
: "${TAKER_ID:?}"
: "${AGENT_ID:?}"
: "${ORACLE_ID:?}"

if [[ "${1:-}" == "--continue" || "${1:-}" == "--from-deposit" || "${1:-}" == "--from-list" || "${1:-}" == "--from-trade" || "${1:-}" == "--from-cross" || "${1:-}" == "--from-fill" || "${1:-}" == "--from-funding" || "${1:-}" == "--from-flatten" ]]; then
  echo "Token and market contract are already deployed"
else
step "Token"
cargo build --manifest-path "${ROOT}/token/Cargo.toml" --target wasm32-unknown-unknown --release
TOKEN_WASM="${ROOT}/token/target/wasm32-unknown-unknown/release/marks_token.wasm"
INIT="$(mktemp "${TMPDIR:-/tmp}/marks-token.XXXXXX")"
printf '{"owner_id":"%s"}\n' "${COLLATERAL_ID}" > "${INIT}"
TOKEN_DEPLOY="$(near_exec contract deploy "${COLLATERAL_ID}" \
  use-file "${TOKEN_WASM}" \
  with-init-call new file-args "${INIT}" \
  prepaid-gas '300 Tgas' \
  attached-deposit '0 NEAR' \
  network-config testnet \
  sign-with-keychain \
  send)"
printf '%s\n' "${TOKEN_DEPLOY}"
show_tx "${TOKEN_DEPLOY}"

step "Market contract"
"${ROOT}/scripts/deploy.sh"
echo "Contract: https://testnet.nearblocks.io/address/${CONTRACT_ID}"
fi

step "Discover the NEAR asset id"
ASSET_ID=""
for CANDIDATE in wrap.near wrap.testnet near; do
  PRICE="$(near_view "${ORACLE_ID}" get_price_data "{\"asset_ids\":[\"${CANDIDATE}\"]}" || true)"
  if printf '%s\n' "${PRICE}" | grep -q "\"asset_id\": \"${CANDIDATE}\""; then
    ASSET_ID="${CANDIDATE}"
    break
  fi
done
if [[ -z "${ASSET_ID}" ]]; then
  echo "price-oracle.testnet did not return a NEAR price for wrap.near, wrap.testnet, or near" >&2
  exit 1
fi
echo "Oracle asset: ${ASSET_ID}"

if [[ "${1:-}" == "--from-deposit" || "${1:-}" == "--from-list" || "${1:-}" == "--from-trade" || "${1:-}" == "--from-cross" || "${1:-}" == "--from-fill" || "${1:-}" == "--from-funding" || "${1:-}" == "--from-flatten" ]]; then
  echo "Accounts are already registered and minted"
else
step "Register token accounts and mint"
for ACCOUNT in "${CONTRACT_ID}" "${TRADER_ID}" "${TAKER_ID}" "${AGENT_ID}"; do
  REG="$(near_call "${COLLATERAL_ID}" storage_deposit "{\"account_id\":\"${ACCOUNT}\"}" "${CONTRACT_ID}" "0.01 NEAR")"
  show_tx "${REG}"
done
for ACCOUNT in "${CONTRACT_ID}" "${TRADER_ID}" "${TAKER_ID}" "${AGENT_ID}"; do
  AMOUNT="${MINT}"
  if [[ "${ACCOUNT}" == "${CONTRACT_ID}" ]]; then
    AMOUNT="${INSURANCE}"
  fi
  MINTED="$(near_call "${COLLATERAL_ID}" mint "{\"account_id\":\"${ACCOUNT}\",\"amount\":\"${AMOUNT}\"}" "${COLLATERAL_ID}")"
  show_tx "${MINTED}"
done
fi

if [[ "${1:-}" != "--from-trade" && "${1:-}" != "--from-cross" && "${1:-}" != "--from-fill" && "${1:-}" != "--from-funding" && "${1:-}" != "--from-flatten" ]]; then
step "Lister deposits insurance and lists NEAR-PERP"
if [[ "${1:-}" != "--from-list" ]]; then
LISTER_DEPOSIT="$(near_call "${COLLATERAL_ID}" ft_transfer_call "{\"receiver_id\":\"${CONTRACT_ID}\",\"amount\":\"${INSURANCE}\",\"memo\":null,\"msg\":\"\"}" "${TRADER_ID}" "1 yoctoNEAR" "100 Tgas")"
show_tx "${LISTER_DEPOSIT}"
fi
CREATED="$(near_call "${CONTRACT_ID}" create_market "{\"symbol\":\"${SYMBOL}\",\"category\":\"${CATEGORY}\",\"tick_size\":\"${TICK_SIZE}\",\"initial_margin_bps\":${INITIAL_MARGIN_BPS},\"maintenance_margin_bps\":${MAINTENANCE_MARGIN_BPS},\"max_funding_bps\":${MAX_FUNDING_BPS},\"funding_interval_ns\":${FUNDING_INTERVAL_NS},\"asset_id\":\"${ASSET_ID}\",\"stale_after_ns\":${STALE_AFTER_NS},\"insurance\":\"${INSURANCE}\",\"custom_request\":null}" "${TRADER_ID}")"
show_tx "${CREATED}"

step "Refresh the mark"
MARK=0
for _ in 1 2 3; do
  REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${CONTRACT_ID}" "0.02 NEAR" "300 Tgas")"
  show_tx "${REFRESH}"
  MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
  MARK="$(field "${MARKET}" mark_ticks)"
  echo "Mark ticks: ${MARK}"
  if [[ "${MARK}" != "0" ]]; then
    break
  fi
  sleep 5
done
if [[ "${MARK}" == "0" ]]; then
  echo "The oracle callback did not store a mark" >&2
  exit 1
fi
fi

if [[ "${1:-}" != "--from-cross" && "${1:-}" != "--from-fill" && "${1:-}" != "--from-funding" && "${1:-}" != "--from-flatten" ]]; then
step "Trader and taker deposit and commit"
if [[ "${1:-}" == "--from-trade" ]]; then
  REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${CONTRACT_ID}" "0.02 NEAR" "300 Tgas")"
  show_tx "${REFRESH}"
  MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
  MARK="$(field "${MARKET}" mark_ticks)"
fi
if [[ -z "${MARK:-}" ]]; then
  MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
  MARK="$(field "${MARKET}" mark_ticks)"
  echo "Mark ticks: ${MARK}"
fi
for ACCOUNT in "${TRADER_ID}" "${TAKER_ID}" "${AGENT_ID}"; do
  SEND_AMOUNT="${MINT}"
  if [[ "${ACCOUNT}" == "${TRADER_ID}" ]]; then
    SEND_AMOUNT=$((MINT - INSURANCE))
  fi
  SENT="$(near_call "${COLLATERAL_ID}" ft_transfer_call "{\"receiver_id\":\"${CONTRACT_ID}\",\"amount\":\"${SEND_AMOUNT}\",\"memo\":null,\"msg\":\"\"}" "${ACCOUNT}" "1 yoctoNEAR" "100 Tgas")"
  show_tx "${SENT}"
done
for ACCOUNT in "${TRADER_ID}" "${TAKER_ID}"; do
  COMMITTED="$(near_call "${CONTRACT_ID}" commit "{\"symbol\":\"${SYMBOL}\",\"amount\":\"${COMMIT}\"}" "${ACCOUNT}")"
  show_tx "${COMMITTED}"
  TRADER="$(near_view "${CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${ACCOUNT}\"}")"
  expect "${ACCOUNT} collateral" "$(field "${TRADER}" collateral)" "${COMMIT}"
done
fi

if [[ "${1:-}" != "--from-funding" && "${1:-}" != "--from-flatten" ]]; then
step "Rest a bid, read it, then cross"
if [[ -z "${MARK:-}" ]]; then
  MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
  MARK="$(field "${MARKET}" mark_ticks)"
  echo "Mark ticks: ${MARK}"
fi
BID_TICKS=$((MARK - 1))
if [[ "${BID_TICKS}" -lt 1 ]]; then
  BID_TICKS=1
fi
if [[ "${1:-}" == "--from-cross" || "${1:-}" == "--from-fill" || "${1:-}" == "--from-funding" || "${1:-}" == "--from-flatten" ]]; then
  ORDER_ID=1
  echo "Using the bid already resting as order ${ORDER_ID}"
else
REST="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"bid\",\"kind\":\"limit\",\"ticks\":${BID_TICKS},\"lots\":${LOTS}}" "${TRADER_ID}")"
show_tx "${REST}"
ORDER_ID="$(field "${REST}" order_id)"
expect "rested lots" "$(field "${REST}" rested_lots)" "${LOTS}"
fi
ORDER="$(near_view "${CONTRACT_ID}" get_order "{\"symbol\":\"${SYMBOL}\",\"order_id\":${ORDER_ID}}")"
expect "order lots" "$(field "${ORDER}" lots)" "${LOTS}"
BOOK="$(near_view "${CONTRACT_ID}" get_l2 "{\"symbol\":\"${SYMBOL}\",\"depth\":5}")"
expect "best bid lots" "$(field "${BOOK}" bids.0.lots)" "${LOTS}"

if [[ "${1:-}" != "--from-fill" ]]; then
ASK="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"ask\",\"kind\":\"limit\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TRADER_ID}")"
show_tx "${ASK}"
fi
REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${CONTRACT_ID}" "0.02 NEAR" "300 Tgas")"
show_tx "${REFRESH}"
MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
MARK="$(field "${MARKET}" mark_ticks)"
echo "Mark ticks before the cross: ${MARK}"
CROSS="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"bid\",\"kind\":\"immediate_or_cancel\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TAKER_ID}")"
show_tx "${CROSS}"
expect "filled lots" "$(field "${CROSS}" filled_lots)" "${LOTS}"
TAKER_VIEW="$(near_view "${CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${TAKER_ID}\"}")"
TRADER_VIEW="$(near_view "${CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${TRADER_ID}\"}")"
expect "taker lots after the cross" "$(field "${TAKER_VIEW}" base_lots)" "1"
expect "trader lots after the cross" "$(field "${TRADER_VIEW}" base_lots)" "-1"

step "Cancel the resting bid"
CANCEL="$(near_call "${CONTRACT_ID}" cancel_order "{\"symbol\":\"${SYMBOL}\",\"order_id\":${ORDER_ID}}" "${TRADER_ID}")"
show_tx "${CANCEL}"
GONE="$(near_view "${CONTRACT_ID}" get_order "{\"symbol\":\"${SYMBOL}\",\"order_id\":${ORDER_ID}}")"
expect "cancelled order" "$(field "${GONE}" @)" "null"
echo "Order ${ORDER_ID} is gone"
fi

if [[ "${1:-}" != "--from-flatten" ]]; then
step "Funding"
RATE="$(near_view "${CONTRACT_ID}" get_funding_rate_bps "{\"symbol\":\"${SYMBOL}\"}")"
echo "Funding rate bps: ${RATE}"
echo "Waiting one funding interval"
sleep 12
SETTLE="$(near_call "${CONTRACT_ID}" settle_funding "{\"symbol\":\"${SYMBOL}\"}" "${TAKER_ID}")"
show_tx "${SETTLE}"
expect "funding payment" "$(field "${SETTLE}" @)" "0"

step "Liquidate a healthy account"
set +e
LIQ="$(near_call "${CONTRACT_ID}" liquidate "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${TAKER_ID}\"}" "${TRADER_ID}" 2>&1)"
LIQ_STATUS=$?
set -e
printf '%s\n' "${LIQ}"
show_tx "${LIQ}"
if [[ "${LIQ_STATUS}" -eq 0 ]]; then
  echo "A healthy account was liquidated" >&2
  exit 1
fi
echo "Healthy liquidation was rejected"

step "Withdraw unallocated balance"
WITHDRAW=$((MINT - INSURANCE - COMMIT))
BEFORE="$(field "$(near_view "${COLLATERAL_ID}" ft_balance_of "{\"account_id\":\"${TRADER_ID}\"}")" @)"
echo "Balance before withdraw: ${BEFORE}"
OUT="$(near_call "${CONTRACT_ID}" withdraw "{\"amount\":\"${WITHDRAW}\"}" "${TRADER_ID}" "0 NEAR" "50 Tgas")"
show_tx "${OUT}"
AFTER="$(field "$(near_view "${COLLATERAL_ID}" ft_balance_of "{\"account_id\":\"${TRADER_ID}\"}")" @)"
echo "Balance after withdraw: ${AFTER}"
WANTED=$((BEFORE + WITHDRAW))
expect "token balance" "${AFTER}" "${WANTED}"
fi

step "Flatten, then the quoting agent"
REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${CONTRACT_ID}" "0.02 NEAR" "300 Tgas")"
show_tx "${REFRESH}"
MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
MARK="$(field "${MARKET}" mark_ticks)"
echo "Mark ticks before the agent: ${MARK}"
FLAT_ASK="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"ask\",\"kind\":\"limit\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TAKER_ID}")"
show_tx "${FLAT_ASK}"
FLAT_BID="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"bid\",\"kind\":\"immediate_or_cancel\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TRADER_ID}")"
show_tx "${FLAT_BID}"
expect "flatten fill" "$(field "${FLAT_BID}" filled_lots)" "${LOTS}"
"${ROOT}/scripts/quote.sh"
ASK_ID="$(tail -1 "${ROOT}/scripts/agent-orders")"
ASK_TICKS=$((MARK + 1))
REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark "{\"symbol\":\"${SYMBOL}\"}" "${CONTRACT_ID}" "0.02 NEAR" "300 Tgas")"
show_tx "${REFRESH}"
LIFT="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"bid\",\"kind\":\"immediate_or_cancel\",\"ticks\":${ASK_TICKS},\"lots\":${LOTS}}" "${TAKER_ID}")"
show_tx "${LIFT}"
expect "agent ask filled" "$(field "${LIFT}" filled_lots)" "${LOTS}"
AGENT_VIEW="$(near_view "${CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${AGENT_ID}\"}")"
TAKER_VIEW="$(near_view "${CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${TAKER_ID}\"}")"
expect "agent lots" "$(field "${AGENT_VIEW}" base_lots)" "-1"
expect "taker lots" "$(field "${TAKER_VIEW}" base_lots)" "1"
BOOK="$(near_view "${CONTRACT_ID}" get_l2 "{\"symbol\":\"${SYMBOL}\",\"depth\":5}")"
if printf '%s\n' "${BOOK}" | grep -q "\"ticks\":${ASK_TICKS}"; then
  echo "The lifted ask is still on the book" >&2
  exit 1
fi
echo "The ask at ${ASK_TICKS} is gone"

step "Gold, only if the oracle returns a price"
GOLD_REQUEST='[{"id":"gold","token_id":"","source":{"custom":{"url":"https://api.gold-api.com/price/XAU","json_path":"price","value_type":"number","method":"GET"}}}]'
set +e
GOLD_FETCH="$(near_call "${ORACLE_ID}" request_custom_data "{\"custom_data_request\":${GOLD_REQUEST},\"resource_limits\":null}" "${CONTRACT_ID}" "0.02 NEAR" "200 Tgas" 2>&1)"
GOLD_STATUS=$?
set -e
printf '%s\n' "${GOLD_FETCH}"
if [[ "${GOLD_STATUS}" -eq 0 ]] && printf '%s\n' "${GOLD_FETCH}" | grep -Eq '"value"[[:space:]]*:[[:space:]]*[0-9]'; then
  GOLD_CREATE="$(near_call "${CONTRACT_ID}" create_market "{\"symbol\":\"XAU-PERP\",\"category\":\"metal\",\"tick_size\":\"${TICK_SIZE}\",\"initial_margin_bps\":${INITIAL_MARGIN_BPS},\"maintenance_margin_bps\":${MAINTENANCE_MARGIN_BPS},\"max_funding_bps\":${MAX_FUNDING_BPS},\"funding_interval_ns\":${FUNDING_INTERVAL_NS},\"asset_id\":\"XAU\",\"stale_after_ns\":${STALE_AFTER_NS},\"insurance\":\"0\",\"custom_request\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${GOLD_REQUEST}")}" "${CONTRACT_ID}")"
  show_tx "${GOLD_CREATE}"
  GOLD_REFRESH="$(near_call "${CONTRACT_ID}" refresh_mark '{"symbol":"XAU-PERP"}' "${CONTRACT_ID}" "0.02 NEAR" "200 Tgas")"
  show_tx "${GOLD_REFRESH}"
  GOLD_MARKET="$(near_view "${CONTRACT_ID}" get_market '{"symbol":"XAU-PERP"}')"
  GOLD_MARK="$(field "${GOLD_MARKET}" mark_ticks)"
  echo "Gold mark ticks: ${GOLD_MARK}"
  if [[ "${GOLD_MARK}" == "0" ]]; then
    echo "The gold callback did not store a mark" >&2
    exit 1
  fi
else
  echo "Gold fetch did not return a price. No XAU-PERP row was created."
fi

printf 'NEXT_PUBLIC_CONTRACT_ID=%s\nNEXT_PUBLIC_INTENTS_RECIPIENT=marks.near\n' "${CONTRACT_ID}" > "${ROOT}/web/.env.local"
echo
echo "Board contract: ${CONTRACT_ID}"
echo "https://testnet.nearblocks.io/address/${CONTRACT_ID}"

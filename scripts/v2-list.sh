#!/usr/bin/env bash
# List the twelve perps, the seven shares and two capped-call series per
# share on Marks v2, then fund the lending pool and the share desk.
#   ./scripts/v2-list.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

POOL_USD="${V2_POOL_USD:-100000}"
DESK_USD="${V2_DESK_USD:-100000}"

refresh() {
  local method="$1" key="$2" value="$3"
  run near_call "${V2_CONTRACT_ID}" "${method}" "{\"${key}\":\"${value}\"}" "${V2_CONTRACT_ID}" "0.02 NEAR" "300 Tgas"
  show_tx "${LAST}"
}

while read -r SYMBOL CATEGORY ASSET; do
  [[ -z "${SYMBOL}" ]] && continue
  if has_code "${V2_CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}"; then
    echo "${SYMBOL} is already listed"
  else
    echo "Listing ${SYMBOL}"
    run near_call "${V2_CONTRACT_ID}" create_market "{\"symbol\":\"${SYMBOL}\",\"category\":\"${CATEGORY}\",\"tick_size\":\"${V2_TICK}\",\"initial_margin_bps\":${INITIAL_MARGIN_BPS},\"maintenance_margin_bps\":${MAINTENANCE_MARGIN_BPS},\"max_funding_bps\":${MAX_FUNDING_BPS},\"funding_interval_ns\":${V2_FUNDING_NS},\"asset_id\":\"${ASSET}\",\"stale_after_ns\":${V2_STALE_NS},\"insurance\":\"0\",\"custom_request\":null}" "${V2_CONTRACT_ID}"
    show_tx "${LAST}"
  fi
  echo "Refreshing ${SYMBOL}"
  refresh refresh_mark symbol "${SYMBOL}"
done < <(demo_markets)

while read -r ASSET NAME; do
  [[ -z "${ASSET}" ]] && continue
  if has_code "${V2_CONTRACT_ID}" get_share "{\"asset_id\":\"${ASSET}\"}"; then
    echo "${ASSET} share is already listed"
  else
    echo "Listing the ${NAME} share"
    run near_call "${V2_CONTRACT_ID}" list_share "{\"asset_id\":\"${ASSET}\",\"name\":\"${NAME}\",\"stale_after_ns\":${V2_STALE_NS}}" "${V2_CONTRACT_ID}"
    show_tx "${LAST}"
  fi
  refresh refresh_share asset_id "${ASSET}"
done < <(v2_shares)

run near_view "${V2_CONTRACT_ID}" get_series_list '{}'
LISTED="${LAST}"
NOW_NS="$(python3 -c 'import time; print(time.time_ns())')"
while read -r ASSET NAME; do
  [[ -z "${ASSET}" ]] && continue
  if printf '%s' "${LISTED}" | grep -q "\"asset_id\": *\"${ASSET}\""; then
    echo "${NAME} already has call series"
    continue
  fi
  run near_view "${V2_CONTRACT_ID}" get_share "{\"asset_id\":\"${ASSET}\"}"
  PRICE="$(field "${LAST}" price)"
  # Seven days at the money with a 10 percent cap, and thirty days 5 percent out with a 20 percent cap.
  while read -r DAYS STRIKE_BPS CAP_BPS; do
    STRIKE=$(( (PRICE * STRIKE_BPS / 10000) / USD * USD ))
    CAP=$(( (PRICE * CAP_BPS / 10000) / USD * USD ))
    [[ "${CAP}" -le "${STRIKE}" ]] && CAP=$((STRIKE + USD))
    EXPIRY=$((NOW_NS + DAYS * 86400 * 1000000000))
    echo "Listing a ${NAME} call: strike ${STRIKE}, cap ${CAP}, ${DAYS} days"
    run near_call "${V2_CONTRACT_ID}" list_series "{\"asset_id\":\"${ASSET}\",\"strike\":\"${STRIKE}\",\"cap\":\"${CAP}\",\"expiry_ns\":${EXPIRY}}" "${V2_CONTRACT_ID}"
    show_tx "${LAST}"
  done <<'EOF'
7 10000 11000
30 10500 12000
EOF
done < <(v2_shares)

run near_view "${V2_CONTRACT_ID}" get_pool '{}'
if [[ "$(field "${LAST}" cash)" == "0" ]]; then
  # The token account is the Marks treasury. A token refuses a transfer to its sender, so the
  # contract account cannot fund itself.
  TOTAL=$(( (POOL_USD + DESK_USD) * USD ))
  echo "Minting ${TOTAL} atoms to the treasury ${V2_TOKEN_ID}"
  run near_call "${V2_TOKEN_ID}" mint "{\"account_id\":\"${V2_TOKEN_ID}\",\"amount\":\"${TOTAL}\"}" "${V2_TOKEN_ID}"
  show_tx "${LAST}"
  echo "Funding the lending pool"
  deposit_to "${V2_TOKEN_ID}" "$((POOL_USD * USD))" pool
  echo "Funding the share desk"
  deposit_to "${V2_TOKEN_ID}" "$((DESK_USD * USD))" desk
else
  echo "The pool already holds $(field "${LAST}" cash) atoms"
fi

echo "Marks v2: https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"

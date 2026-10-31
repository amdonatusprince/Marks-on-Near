#!/usr/bin/env bash
# Mint test USDC to the two existing trader accounts and trade about 300 USDC
# on every demo market, so each row has a price, open interest, and volume.
#   ./scripts/demo-trade.sh

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
load_testnet
require_demo

PLAN="$(mktemp "${TMPDIR:-/tmp}/marks-demo-plan.XXXXXX")"
: > "${PLAN}"
TOTAL=0

while read -r SYMBOL CATEGORY ASSET; do
  [[ -z "${SYMBOL}" ]] && continue
  run near_view "${DEMO_CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}"
  OI="$(field "${LAST}" open_interest_lots)"
  if [[ "${OI}" != "0" ]]; then
    echo "${SYMBOL} already has ${OI} contracts open"
    continue
  fi
  MARK="$(field "${LAST}" mark_ticks)"
  TICK="$(field "${LAST}" tick_size)"
  if [[ "${MARK}" == "0" ]]; then
    echo "${SYMBOL} has no mark" >&2
    exit 1
  fi
  PER=$((MARK * TICK))
  LOTS=$((300000000 / PER))
  if [[ "${LOTS}" -lt 1 ]]; then
    LOTS=1
  fi
  COST=$((LOTS * PER))
  NEED=$((COST / 10 + 2000000))
  TOTAL=$((TOTAL + NEED))
  echo "${SYMBOL} ${LOTS} ${NEED} ${MARK}" >> "${PLAN}"
  echo "${SYMBOL}: ${LOTS} contracts, mark ${MARK}, margin atoms ${NEED}"
done < <(demo_markets)

if [[ ! -s "${PLAN}" ]]; then
  echo "Every demo market already has open interest"
  exit 0
fi

for ACCOUNT in "${DEMO_CONTRACT_ID}" "${TRADER_ID}" "${TAKER_ID}"; do
  echo "Registering ${ACCOUNT} on the token"
  run near_call "${COLLATERAL_ID}" storage_deposit "{\"account_id\":\"${ACCOUNT}\"}" "${DEMO_CONTRACT_ID}" "0.01 NEAR" "30 Tgas"
  show_tx "${LAST}"
done

for ACCOUNT in "${TRADER_ID}" "${TAKER_ID}"; do
  run near_view "${COLLATERAL_ID}" ft_balance_of "{\"account_id\":\"${ACCOUNT}\"}"
  BAL="$(field "${LAST}" @)"
  if [[ "${BAL}" -lt "${TOTAL}" ]]; then
    echo "Minting ${TOTAL} atoms to ${ACCOUNT}"
    run near_call "${COLLATERAL_ID}" mint "{\"account_id\":\"${ACCOUNT}\",\"amount\":\"${TOTAL}\"}" "${COLLATERAL_ID}"
    show_tx "${LAST}"
  else
    echo "${ACCOUNT} already holds ${BAL} atoms"
  fi
done

SAMPLE="$(awk 'NR==1 {print $1}' "${PLAN}")"
for ACCOUNT in "${TRADER_ID}" "${TAKER_ID}"; do
  run near_view "${DEMO_CONTRACT_ID}" get_trader "{\"symbol\":\"${SAMPLE}\",\"account_id\":\"${ACCOUNT}\"}"
  HAVE="$(field "${LAST}" unallocated)"
  if [[ "${HAVE}" -lt "${TOTAL}" ]]; then
    SHORT=$((TOTAL - HAVE))
    echo "Depositing ${SHORT} atoms from ${ACCOUNT}"
    run near_call "${COLLATERAL_ID}" ft_transfer_call "{\"receiver_id\":\"${DEMO_CONTRACT_ID}\",\"amount\":\"${SHORT}\",\"memo\":null,\"msg\":\"\"}" "${ACCOUNT}" "1 yoctoNEAR" "100 Tgas"
    show_tx "${LAST}"
  else
    echo "${ACCOUNT} already has ${HAVE} unallocated atoms"
  fi
done

while read -r SYMBOL LOTS NEED MARK; do
  for ACCOUNT in "${TRADER_ID}" "${TAKER_ID}"; do
    run near_view "${DEMO_CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${ACCOUNT}\"}"
    HAVE="$(field "${LAST}" collateral)"
    if [[ "${HAVE}" -lt "${NEED}" ]]; then
      echo "Committing ${NEED} atoms of ${ACCOUNT} to ${SYMBOL}"
      run near_call "${DEMO_CONTRACT_ID}" commit "{\"symbol\":\"${SYMBOL}\",\"amount\":\"${NEED}\"}" "${ACCOUNT}"
      show_tx "${LAST}"
    fi
  done
  echo "Resting a ${LOTS} contract ask on ${SYMBOL}"
  run near_call "${DEMO_CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"ask\",\"kind\":\"limit\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TRADER_ID}" "0 NEAR" "100 Tgas"
  show_tx "${LAST}"
  RESTED="$(field "${LAST}" rested_lots)"
  if [[ "${RESTED}" != "${LOTS}" ]]; then
    echo "${SYMBOL} ask rested ${RESTED}, wanted ${LOTS}" >&2
    exit 1
  fi
  echo "Lifting ${LOTS} contracts on ${SYMBOL}"
  run near_call "${DEMO_CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"bid\",\"kind\":\"immediate_or_cancel\",\"ticks\":${MARK},\"lots\":${LOTS}}" "${TAKER_ID}" "0 NEAR" "100 Tgas"
  show_tx "${LAST}"
  FILLED="$(field "${LAST}" filled_lots)"
  if [[ "${FILLED}" != "${LOTS}" ]]; then
    echo "${SYMBOL} filled ${FILLED}, wanted ${LOTS}" >&2
    exit 1
  fi
  run near_view "${DEMO_CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}"
  echo "${SYMBOL} open interest $(field "${LAST}" open_interest_lots), traded $(field "${LAST}" volume_quote)"
done < "${PLAN}"

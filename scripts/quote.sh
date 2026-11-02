#!/usr/bin/env bash
# Post a one-lot bid one tick under the mark and a one-lot ask one tick over it.
# Both are post-only. The agent account is AGENT_ID in scripts/testnet.env.
#
#   ./scripts/quote.sh

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_testnet
: "${AGENT_ID:?AGENT_ID is required in scripts/testnet.env}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOTS=1
COMMIT=10000000
ORDERS="${ROOT}/scripts/agent-orders"

MARKET="$(near_view "${CONTRACT_ID}" get_market "{\"symbol\":\"${SYMBOL}\"}")"
MARK="$(printf '%s\n' "${MARKET}" | python3 "${ROOT}/scripts/json_get.py" mark_ticks)"
if [[ "${MARK}" -lt 2 ]]; then
  echo "Mark ${MARK} is too low for a one-tick quote" >&2
  exit 1
fi
BID=$((MARK - 1))
ASK=$((MARK + 1))
echo "Mark ${MARK}. Bid ${BID}. Ask ${ASK}. Size ${LOTS}."

near_call "${CONTRACT_ID}" commit "{\"symbol\":\"${SYMBOL}\",\"amount\":\"${COMMIT}\"}" "${AGENT_ID}"

if [[ -f "${ORDERS}" ]]; then
  while read -r PREVIOUS; do
    [[ -z "${PREVIOUS}" ]] && continue
    echo "Cancelling previous order ${PREVIOUS}"
    near_call "${CONTRACT_ID}" cancel_order "{\"symbol\":\"${SYMBOL}\",\"order_id\":${PREVIOUS}}" "${AGENT_ID}" || true
  done < "${ORDERS}"
fi

place() {
  local side="$1"
  local ticks="$2"
  local output
  output="$(near_call "${CONTRACT_ID}" place_order "{\"symbol\":\"${SYMBOL}\",\"side\":\"${side}\",\"kind\":\"post_only\",\"ticks\":${ticks},\"lots\":${LOTS}}" "${AGENT_ID}")"
  printf '%s\n' "${output}"
  printf '%s\n' "${output}" | python3 "${ROOT}/scripts/json_get.py" order_id
}

echo "Placing the bid"
BID_OUT="$(place bid "${BID}")"
BID_ID="$(printf '%s\n' "${BID_OUT}" | tail -1)"
echo "Placing the ask"
ASK_OUT="$(place ask "${ASK}")"
ASK_ID="$(printf '%s\n' "${ASK_OUT}" | tail -1)"
printf '%s\n%s\n' "${BID_ID}" "${ASK_ID}" > "${ORDERS}"
echo "Bid order ${BID_ID} at tick ${BID}"
echo "Ask order ${ASK_ID} at tick ${ASK}"

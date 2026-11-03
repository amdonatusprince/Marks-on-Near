#!/usr/bin/env bash
# Run every v2 flow once on testnet and print each transaction link:
# faucet, shares, a share loan, a perp loan, a USDC gift by link,
# a position gift, and a capped-call buy. AGENT_ID relays the claims.
#   ./scripts/v2-exercise.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

TRADERS=()
while read -r WHO; do
  [[ -n "${WHO}" ]] && TRADERS+=("${WHO}")
done < <(v2_traders)
NEWCOMER="${TRADERS[5]}"
RELAYER="${AGENT_ID}"
KEYS="${ROOT}/scripts/gift_keys.mjs"

step() {
  echo
  echo "== $1"
}

call() {
  local contract="$1" method="$2" args="$3" signer="$4" deposit="${5:-0 NEAR}"
  run near_call "${contract}" "${method}" "${args}" "${signer}" "${deposit}" "300 Tgas"
  show_tx "${LAST}"
}

step "Faucet: ${RELAYER} claims 1,000 mUSDC for ${NEWCOMER}"
if attempt near_call "${V2_TOKEN_ID}" faucet "{\"account_id\":\"${NEWCOMER}\"}" "${RELAYER}" "0 NEAR" "300 Tgas"; then
  show_tx "${LAST}"
  call "${V2_TOKEN_ID}" ft_transfer_call "{\"receiver_id\":\"${V2_CONTRACT_ID}\",\"amount\":\"$((1000 * USD))\",\"memo\":null,\"msg\":\"\"}" "${NEWCOMER}" "1 yoctoNEAR"
else
  # A release build traps on panic, so the cooldown text does not survive.
  faucet_out="${LAST}"
  run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"SOL-PERP\",\"account_id\":\"${NEWCOMER}\"}"
  unallocated="$(field "${LAST}" unallocated)"
  if ! grep -q "faucet cooldown" <<< "${faucet_out}" && [[ "${unallocated}" == "0" ]]; then
    echo "Faucet failed and ${NEWCOMER} has no Marks balance" >&2
    exit 1
  fi
  echo "Faucet already claimed today"
fi

step "Shares: buy 300 USDC of Apple, sell a tenth of a share"
call "${V2_CONTRACT_ID}" refresh_share '{"asset_id":"aapl"}' "${V2_CONTRACT_ID}" "0.02 NEAR"
call "${V2_CONTRACT_ID}" buy_shares "{\"asset_id\":\"aapl\",\"amount\":\"$((300 * USD))\"}" "${NEWCOMER}"
call "${V2_CONTRACT_ID}" sell_shares '{"asset_id":"aapl","units":"100000"}' "${NEWCOMER}"

step "Share loan: lock every Apple share, borrow 100 USDC, repay 50"
UNITS=0
for ((try = 1; try <= 6; try++)); do
  run near_view "${V2_CONTRACT_ID}" get_holdings "{\"account_id\":\"${NEWCOMER}\"}"
  UNITS="$(printf '%s\n' "${LAST}" | python3 -c '
import json, sys
text = sys.stdin.read().splitlines()
raw = ""
for index, line in enumerate(text):
    low = line.lower()
    if "return value" in low and "printed" in low:
        chunk = []
        for nxt in text[index + 1:]:
            stripped = nxt.strip()
            if stripped.startswith("The \"") or stripped.startswith("Here is your"):
                break
            if stripped:
                chunk.append(stripped)
        raw = "".join(chunk)
        break
try:
    data = json.loads(raw) if raw else []
except json.JSONDecodeError:
    data = []
held = dict(pair for pair in data if isinstance(pair, list) and len(pair) == 2) if isinstance(data, list) else {}
print(held.get("aapl", 0))
')"
  [[ "${UNITS}" != "0" ]] && break
  sleep $((try * 2))
done
[[ "${UNITS}" != "0" ]] || {
  echo "No Apple shares to borrow against" >&2
  exit 1
}
call "${V2_CONTRACT_ID}" borrow_against "{\"asset_id\":\"aapl\",\"units\":\"${UNITS}\",\"amount\":\"$((100 * USD))\"}" "${NEWCOMER}"
call "${V2_CONTRACT_ID}" repay_share_loan "{\"asset_id\":\"aapl\",\"amount\":\"$((50 * USD))\"}" "${NEWCOMER}"

step "Perp loan: a seeded SOL position borrows 50 USDC and repays 20"
BORROWER=""
for WHO in "${TRADERS[@]}"; do
  run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"SOL-PERP\",\"account_id\":\"${WHO}\"}"
  LIMIT="$(field "${LAST}" borrow_limit)"
  GIFT="$(field "${LAST}" gift_id)"
  if [[ "${LIMIT}" -ge $((50 * USD)) && "${GIFT}" == "null" ]]; then
    BORROWER="${WHO}"
    break
  fi
done
if [[ -z "${BORROWER}" ]]; then
  echo "No SOL position can borrow 50 USDC" >&2
  exit 1
fi
echo "Borrower ${BORROWER}"
call "${V2_CONTRACT_ID}" refresh_mark '{"symbol":"SOL-PERP"}' "${BORROWER}" "0.02 NEAR"
call "${V2_CONTRACT_ID}" borrow "{\"symbol\":\"SOL-PERP\",\"amount\":\"$((50 * USD))\"}" "${BORROWER}"
call "${V2_CONTRACT_ID}" repay "{\"symbol\":\"SOL-PERP\",\"amount\":\"$((20 * USD))\"}" "${BORROWER}"

step "Gift by link: ${NEWCOMER} sends 25 USDC, ${RELAYER} submits the claim for ${TRADERS[4]}"
KEY="$(node "${KEYS}" new "${V2_CONTRACT_ID}" "${NEWCOMER}")"
CLAIM_KEY="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["claim_key"])')"
PROOF="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key_proof"])')"
SECRET="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])')"
call "${V2_CONTRACT_ID}" create_gift "{\"asset\":{\"kind\":\"usdc\",\"amount\":\"$((25 * USD))\"},\"claim_key\":\"${CLAIM_KEY}\",\"key_proof\":\"${PROOF}\",\"expiry_days\":7,\"note\":\"\"}" "${NEWCOMER}"
GIFT_ID="$(field "${LAST}" @)"
echo "Gift ${GIFT_ID}"
SIGNATURE="$(node "${KEYS}" claim "${V2_CONTRACT_ID}" "${SECRET}" "${GIFT_ID}" "${TRADERS[4]}")"
call "${V2_CONTRACT_ID}" claim_gift "{\"gift_id\":${GIFT_ID},\"recipient\":\"${TRADERS[4]}\",\"signature\":\"${SIGNATURE}\"}" "${RELAYER}"

step "Position gift: a seeded trader gives an open perp to ${RELAYER}"
GIVER=""
GIFT_SYMBOL=""
while read -r SYMBOL _ _; do
  for WHO in "${TRADERS[@]:0:5}"; do
    run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"${SYMBOL}\",\"account_id\":\"${WHO}\"}" > /dev/null
    LOTS="$(field "${LAST}" base_lots)"
    EQUITY="$(field "${LAST}" equity)"
    DEBT="$(field "${LAST}" debt)"
    if [[ "${LOTS}" != "0" && "${EQUITY}" -gt 0 && "${DEBT}" == "0" ]]; then
      GIVER="${WHO}"
      GIFT_SYMBOL="${SYMBOL}"
      break 2
    fi
  done
done < <(demo_markets)
if [[ -z "${GIVER}" ]]; then
  echo "No seeded trader holds a position to gift" >&2
  exit 1
fi
call "${V2_CONTRACT_ID}" refresh_mark "{\"symbol\":\"${GIFT_SYMBOL}\"}" "${V2_CONTRACT_ID}" "0.02 NEAR"
KEY="$(node "${KEYS}" new "${V2_CONTRACT_ID}" "${GIVER}")"
CLAIM_KEY="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["claim_key"])')"
PROOF="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key_proof"])')"
SECRET="$(printf '%s' "${KEY}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["secret"])')"
call "${V2_CONTRACT_ID}" create_gift "{\"asset\":{\"kind\":\"position\",\"symbol\":\"${GIFT_SYMBOL}\"},\"claim_key\":\"${CLAIM_KEY}\",\"key_proof\":\"${PROOF}\",\"expiry_days\":7,\"note\":\"\"}" "${GIVER}"
GIFT_ID="$(field "${LAST}" @)"
SIGNATURE="$(node "${KEYS}" claim "${V2_CONTRACT_ID}" "${SECRET}" "${GIFT_ID}" "${RELAYER}")"
call "${V2_CONTRACT_ID}" claim_gift "{\"gift_id\":${GIFT_ID},\"recipient\":\"${RELAYER}\",\"signature\":\"${SIGNATURE}\"}" "${RELAYER}"
run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"${GIFT_SYMBOL}\",\"account_id\":\"${RELAYER}\"}"
echo "${RELAYER} now holds $(field "${LAST}" base_lots) lots of ${GIFT_SYMBOL}"

step "Capped call: ${NEWCOMER} lifts one contract at the best ask"
run near_view "${V2_CONTRACT_ID}" get_series_list '{}'
read -r SERIES ASK < <(printf '%s\n' "${LAST}" | python3 -c '
import json, sys
text = sys.stdin.read().splitlines()
raw = ""
for index, line in enumerate(text):
    low = line.lower()
    if "return value" in low and "printed" in low:
        chunk = []
        for nxt in text[index + 1:]:
            stripped = nxt.strip()
            if stripped.startswith("The \"") or stripped.startswith("Here is your"):
                break
            chunk.append(nxt)
        raw = "\n".join(chunk)
        break
rows = json.loads(raw)
row = next(r for r in rows if r["best_ask"])
print(row["id"], row["best_ask"])
')
call "${V2_CONTRACT_ID}" place_option "{\"series_id\":\"${SERIES}\",\"side\":\"bid\",\"premium\":\"${ASK}\",\"lots\":1}" "${NEWCOMER}"

echo
echo "Every v2 flow ran on https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"

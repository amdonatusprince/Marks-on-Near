#!/usr/bin/env bash
# Fill every v2 book. Per perp: 10 to 30 random fills within 0.8 percent of
# the mark between the six traders, then 5 to 8 resting levels per side.
# Per call series: two asks, two bids and one fill. Three workers run at once,
# each signing with its own two traders, so no key sends two transactions at a time.
#   ./scripts/v2-seed.sh
#   ./scripts/v2-seed.sh --options      only the call books

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

ALL_TRADERS=()
while read -r WHO; do
  [[ -n "${WHO}" ]] && ALL_TRADERS+=("${WHO}")
done < <(v2_traders)
TRADERS=("${ALL_TRADERS[@]}")
WORKERS=3
COMMIT_USD=1200

run() {
  attempt "$@" || exit $?
}

pick() {
  echo "${TRADERS[$((RANDOM % ${#TRADERS[@]}))]}"
}

# Step from the maker's index: redrawing RANDOM inside a command substitution
# can return the same trader forever.
other_than() {
  local count=${#TRADERS[@]} i
  for ((i = 0; i < count; i++)); do
    if [[ "${TRADERS[$i]}" == "$1" ]]; then
      echo "${TRADERS[$(((i + 1 + RANDOM % (count - 1)) % count))]}"
      return
    fi
  done
}

# A tick offset from the mark: up to `spread` hundredths of a percent either way.
near_mark() {
  local mark="$1" bps="$2"
  python3 -c "import sys; m,b=int(sys.argv[1]),int(sys.argv[2]); print(max(1, m + m*b//10000))" "${mark}" "${bps}"
}

lots_for() {
  local per_lot="$1" usd
  usd=$((20 + RANDOM % 61))
  local lots=$((usd * USD / per_lot))
  [[ "${lots}" -lt 1 ]] && lots=1
  echo "${lots}"
}

order() {
  local who="$1" symbol="$2" side="$3" kind="$4" ticks="$5" lots="$6"
  if attempt near_call "${V2_CONTRACT_ID}" place_order "{\"symbol\":\"${symbol}\",\"side\":\"${side}\",\"kind\":\"${kind}\",\"ticks\":${ticks},\"lots\":${lots}}" "${who}" "0 NEAR" "100 Tgas"; then
    show_tx "${LAST}"
  else
    echo "Order refused: ${who} ${side} ${lots} at ${ticks}"
    return 1
  fi
}

fund_traders() {
  local need=$((COMMIT_USD * 12 * USD + 5000 * USD))
  for WHO in "${TRADERS[@]}"; do
    run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"SOL-PERP\",\"account_id\":\"${WHO}\"}"
    local unallocated collateral
    unallocated="$(field "${LAST}" unallocated)"
    collateral="$(field "${LAST}" collateral)"
    if [[ "${collateral}" != "0" || "${unallocated}" -ge "${need}" ]]; then
      echo "${WHO} is already funded"
      continue
    fi
    echo "Minting and depositing for ${WHO}"
    run near_call "${V2_TOKEN_ID}" mint "{\"account_id\":\"${WHO}\",\"amount\":\"${need}\"}" "${V2_TOKEN_ID}"
    deposit_to "${WHO}" "${need}"
  done
}

seed_perp() {
  local symbol="$1"
  run near_view "${V2_CONTRACT_ID}" get_l2 "{\"symbol\":\"${symbol}\",\"depth\":20}"
  local sides
  sides="$(printf '%s\n' "${LAST}" | python3 -c '
import json, re, sys
text = re.sub(r"\x1b\[[0-9;]*m", "", sys.stdin.read())
book = json.JSONDecoder().raw_decode(text[text.index("{") :])[0]
print(len(book["bids"]), len(book["asks"]))
')"
  local bids asks
  read -r bids asks <<< "${sides}"
  if [[ "${bids}" -ge 5 && "${asks}" -ge 5 ]]; then
    echo "${symbol} already has resting depth (${bids} bids, ${asks} asks)"
    return
  fi
  run near_call "${V2_CONTRACT_ID}" refresh_mark "{\"symbol\":\"${symbol}\"}" "${TRADERS[0]}" "0.02 NEAR" "300 Tgas"
  run near_view "${V2_CONTRACT_ID}" get_market "{\"symbol\":\"${symbol}\"}"
  local mark tick per_lot
  mark="$(field "${LAST}" mark_ticks)"
  tick="$(field "${LAST}" tick_size)"
  per_lot=$((mark * tick))
  for WHO in "${TRADERS[@]}"; do
    run near_view "${V2_CONTRACT_ID}" get_trader "{\"symbol\":\"${symbol}\",\"account_id\":\"${WHO}\"}"
    if [[ "$(field "${LAST}" collateral)" == "0" ]]; then
      run near_call "${V2_CONTRACT_ID}" commit "{\"symbol\":\"${symbol}\",\"amount\":\"$((COMMIT_USD * USD))\"}" "${WHO}"
    fi
  done

  local fills=$((10 + RANDOM % 21))
  echo "${symbol}: ${fills} fills around mark ${mark}"
  for ((i = 1; i <= fills; i++)); do
    local maker taker side opposite ticks lots
    maker="$(pick)"
    taker="$(other_than "${maker}")"
    if ((RANDOM % 2)); then side=bid; opposite=ask; else side=ask; opposite=bid; fi
    ticks="$(near_mark "${mark}" $(( (RANDOM % 161) - 80 )))"
    lots="$(lots_for "${per_lot}")"
    echo "Fill ${i}/${fills}: ${maker} ${side} ${lots} at ${ticks}, ${taker} takes"
    order "${maker}" "${symbol}" "${side}" post_only "${ticks}" "${lots}" || continue
    order "${taker}" "${symbol}" "${opposite}" immediate_or_cancel "${ticks}" "${lots}" || true
  done

  local levels=$((5 + RANDOM % 4))
  echo "${symbol}: ${levels} resting levels per side"
  for ((k = 1; k <= levels; k++)); do
    local gap=$((k * 10 + 10 + RANDOM % 10)) away=$((k * 2))
    local bid ask
    bid="$(near_mark "${mark}" "-${gap}")"
    ask="$(near_mark "${mark}" "${gap}")"
    # A cheap asset rounds several gaps onto one tick, so each level steps out.
    ((bid > mark - away)) && bid=$((mark - away))
    ((ask < mark + away)) && ask=$((mark + away))
    ((bid < 1)) && bid=1
    order "$(pick)" "${symbol}" bid post_only "${bid}" "$(lots_for "${per_lot}")" || true
    order "$(pick)" "${symbol}" ask post_only "${ask}" "$(lots_for "${per_lot}")" || true
  done
}

seed_series() {
  local worker="$1"
  run near_view "${V2_CONTRACT_ID}" get_series_list '{}'
  local ids
  ids="$(printf '%s\n' "${LAST}" | python3 -c '
import json, re, sys
worker, workers = int(sys.argv[1]), int(sys.argv[2])
text = re.sub(r"\x1b\[[0-9;]*m", "", sys.stdin.read())
decoder = json.JSONDecoder()
rows = None
for index, char in enumerate(text):
    if char != "[":
        continue
    try:
        decoded, _ = decoder.raw_decode(text[index:])
    except json.JSONDecodeError:
        continue
    if isinstance(decoded, list) and decoded and isinstance(decoded[0], dict):
        rows = decoded
        break
if rows is None:
    sys.exit("no series list in the command output")
for index, row in enumerate(rows):
    if index % workers != worker:
        continue
    width = int(row["cap"]) - int(row["strike"])
    print(row["id"], width, row["best_ask"] is not None)
' "${worker}" "${WORKERS}")"
  while read -r ID WIDTH QUOTED; do
    [[ -z "${ID}" ]] && continue
    if [[ "${QUOTED}" == "True" ]]; then
      echo "${ID} already has quotes"
      continue
    fi
    local cents=$((WIDTH / 10000))
    echo "Quoting ${ID}, width ${WIDTH}"
    for PCT in 45 55; do
      local premium=$((cents * PCT / 100 * 10000))
      run near_call "${V2_CONTRACT_ID}" place_option "{\"series_id\":\"${ID}\",\"side\":\"ask\",\"premium\":\"${premium}\",\"lots\":$((2 + RANDOM % 4))}" "${TRADERS[0]}" "0 NEAR" "100 Tgas"
      show_tx "${LAST}"
    done
    for PCT in 30 22; do
      local premium=$((cents * PCT / 100 * 10000))
      run near_call "${V2_CONTRACT_ID}" place_option "{\"series_id\":\"${ID}\",\"side\":\"bid\",\"premium\":\"${premium}\",\"lots\":$((2 + RANDOM % 4))}" "${TRADERS[1]}" "0 NEAR" "100 Tgas"
      show_tx "${LAST}"
    done
    local lift=$((cents * 45 / 100 * 10000))
    run near_call "${V2_CONTRACT_ID}" place_option "{\"series_id\":\"${ID}\",\"side\":\"bid\",\"premium\":\"${lift}\",\"lots\":1}" "${TRADERS[1]}" "0 NEAR" "100 Tgas"
    show_tx "${LAST}"
  done <<< "${ids}"
}

# Worker w seeds every third market and series with traders 2w and 2w+1.
work() {
  local worker="$1" options="$2" index=0
  TRADERS=("${ALL_TRADERS[$((worker * 2))]}" "${ALL_TRADERS[$((worker * 2 + 1))]}")
  if [[ "${options}" != "--options" ]]; then
    while read -r SYMBOL _ _; do
      [[ -z "${SYMBOL}" ]] && continue
      if ((index++ % WORKERS == worker)); then
        seed_perp "${SYMBOL}"
      fi
    done < <(demo_markets)
  fi
  seed_series "${worker}"
}

fund_traders
PIDS=()
for ((w = 0; w < WORKERS; w++)); do
  work "${w}" "${1:-}" > "/tmp/v2-seed-${w}.log" 2>&1 &
  PIDS+=("$!")
  echo "Worker ${w} signs as ${ALL_TRADERS[$((w * 2))]} and ${ALL_TRADERS[$((w * 2 + 1))]}, log /tmp/v2-seed-${w}.log"
done
FAILED=0
for ((w = 0; w < WORKERS; w++)); do
  if ! wait "${PIDS[$w]}"; then
    echo "Worker ${w} failed, see /tmp/v2-seed-${w}.log" >&2
    FAILED=1
  fi
done
[[ "${FAILED}" == 0 ]] || exit 1
cat /tmp/v2-seed-*.log
echo "Every book is seeded on https://testnet.nearblocks.io/address/${V2_CONTRACT_ID}"

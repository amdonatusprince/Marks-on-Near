#!/usr/bin/env bash
# Restamp stale v2 markets and shares every 30 minutes, oldest first.
# Each refresh attaches 0.02 NEAR. The agent pays while it can stay above
# 1 NEAR; otherwise the contract account pays and keeps 1 NEAR in reserve.
#   ./scripts/v2-keep.sh
#   ./scripts/v2-keep.sh --loop

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

acquire_lock() {
  local lock="${TMPDIR:-/tmp}/marks-v2-keep.pid" old
  if [[ -f "${lock}" ]]; then
    old="$(cat "${lock}" 2>/dev/null || true)"
    if [[ -n "${old}" ]] && kill -0 "${old}" 2>/dev/null; then
      echo "Keeper already running (${old})."
      exit 0
    fi
  fi
  printf '%s\n' "$$" > "${lock}"
  trap 'rm -f "${lock}"' EXIT
}

RPC="${MARKS_RPC:-https://test.rpc.fastnear.com}"
LEAD="${MARKS_KEEP_LEAD:-1800}"
AGENT_FLOOR="1000000000000000000000000"
CONTRACT_FLOOR="1000000000000000000000000"
FEE="20000000000000000000000"
CUSHION="50000000000000000000000"

chain() {
  python3 - "$1" "$2" "$3" <<'PY'
import base64, json, sys, time, urllib.request

kind, contract, rpc = sys.argv[1], sys.argv[2], sys.argv[3]

def call(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": "marks", "method": method, "params": params}).encode()
    request = urllib.request.Request(rpc, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if "error" in payload:
        raise SystemExit(payload["error"].get("message", "rpc error"))
    return payload["result"]

if kind == "markets":
    now = time.time() * 1_000_000_000

    def view(method):
        result = call("query", {
            "request_type": "call_function",
            "finality": "final",
            "account_id": contract,
            "method_name": method,
            "args_base64": base64.b64encode(b"{}").decode(),
        })
        return json.loads(bytes(result["result"]).decode())

    for market in view("get_markets"):
        age = max(0, int((now - int(market["mark_updated_ns"])) / 1_000_000_000))
        print(f"refresh_mark {market['symbol']} {age}")
    for share in view("get_shares"):
        age = max(0, int((now - int(share["updated_ns"])) / 1_000_000_000))
        print(f"refresh_share {share['asset_id']} {age}")
elif kind == "balance":
    result = call("query", {
        "request_type": "view_account",
        "finality": "final",
        "account_id": contract,
    })
    print(result["amount"])
else:
    raise SystemExit(f"unknown query {kind}")
PY
}

oldest_age() {
  local oldest=-1 method id age
  while read -r method id age; do
    if (( age > oldest )); then
      oldest=$age
    fi
  done < <(chain markets "${V2_CONTRACT_ID}" "${RPC}")
  if (( oldest < 0 )); then
    echo "No prices to refresh." >&2
    return 1
  fi
  printf '%s\n' "${oldest}"
}

payer() {
  local count="$1"
  python3 - "$count" "$FEE" "$CUSHION" "$AGENT_FLOOR" "$CONTRACT_FLOOR" \
    "$(chain balance "${AGENT_ID}" "${RPC}")" \
    "$(chain balance "${V2_CONTRACT_ID}" "${RPC}")" \
    "${AGENT_ID}" "${V2_CONTRACT_ID}" <<'PY'
import sys

count = int(sys.argv[1])
fee = int(sys.argv[2])
cushion = int(sys.argv[3])
agent_floor = int(sys.argv[4])
contract_floor = int(sys.argv[5])
agent_balance = int(sys.argv[6])
contract_balance = int(sys.argv[7])
agent, contract = sys.argv[8], sys.argv[9]
cost = count * fee + cushion
if agent_balance - cost >= agent_floor:
    print(agent)
elif contract_balance - cost >= contract_floor:
    print(contract)
else:
    raise SystemExit(
        f"Need {cost / 1e24:.2f} NEAR. "
        f"Agent has {agent_balance / 1e24:.2f} and keeps 1. "
        f"Contract has {contract_balance / 1e24:.2f} and keeps 1."
    )
PY
}

refresh_all() {
  local due=() method id age signer count args
  while read -r method id age; do
    if (( age >= LEAD )); then
      due+=("${method} ${id}")
    fi
  done < <(chain markets "${V2_CONTRACT_ID}" "${RPC}")
  if (( ${#due[@]} == 0 )); then
    echo "No stale prices to refresh." >&2
    return 1
  fi
  if ! signer="$(payer "${#due[@]}")"; then
    echo "Skipping this pass. ${signer}" >&2
    return 0
  fi
  echo "Refreshing ${#due[@]} prices as ${signer}"
  for row in "${due[@]}"; do
    method="${row%% *}"
    id="${row#* }"
    if [[ "${method}" == "refresh_share" ]]; then
      args="{\"asset_id\":\"${id}\"}"
    else
      args="{\"symbol\":\"${id}\"}"
    fi
    echo "Refreshing ${id}"
    if attempt near_call "${V2_CONTRACT_ID}" "${method}" "${args}" "${signer}" "0.02 NEAR" "300 Tgas"; then
      show_tx "${LAST}"
    else
      echo "Refresh failed for ${id}" >&2
    fi
  done
}

acquire_lock

if [[ "${1:-}" == "--loop" ]]; then
  echo "Keeping ${V2_CONTRACT_ID} marks and shares inside ${LEAD}s."
  while true; do
    if ! age="$(oldest_age)"; then
      sleep 300
      continue
    fi
    if (( age < LEAD )); then
      wait=$((LEAD - age))
      echo "Prices are ${age}s old. Next refresh in ${wait}s."
      sleep "${wait}"
      continue
    fi
    refresh_all
    sleep 60
  done
fi

age="$(oldest_age)"
if (( age < LEAD )); then
  echo "Prices are ${age}s old, inside the ${LEAD}s lead. Nothing to refresh."
  exit 0
fi
refresh_all

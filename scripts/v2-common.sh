#!/usr/bin/env bash
# Helpers for the v2 scripts. Source this. Do not execute it.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-common.sh"

# near-cli's "testnet" connection is the archival RPC, which rate-limits a few
# transactions a minute. "testnet-fastnear" shares its keychain entries.
NETWORK="${NEAR_CLI_NETWORK:-testnet-fastnear}"

# Like run, but waits through an RPC rate limit and returns the status.
attempt() {
  local tries=0 status
  while true; do
    set +e
    LAST="$("$@")"
    status=$?
    set -e
    printf '%s\n' "${LAST}"
    if [[ "${status}" -eq 0 ]] || ! grep -qiE "rate limit|429|too many" <<< "${LAST}" || ((++tries >= 6)); then
      return "${status}"
    fi
    sleep $((tries * 5))
  done
}

V2_TICK=10000
V2_STALE_NS=3600000000000
V2_FUNDING_NS=3600000000000
USD=1000000

require_v2() {
  : "${V2_TOKEN_ID:?V2_TOKEN_ID is missing. Run ./scripts/v2-accounts.sh}"
  : "${V2_ORACLE_ID:?V2_ORACLE_ID is missing. Run ./scripts/v2-accounts.sh}"
  : "${V2_CONTRACT_ID:?V2_CONTRACT_ID is missing. Run ./scripts/v2-accounts.sh}"
  : "${V2_TRADERS:?V2_TRADERS is missing. Run ./scripts/v2-accounts.sh}"
}

# Asset id and display name for every share on the desk.
v2_shares() {
  cat <<'EOF'
aapl Apple
nvda Nvidia
tsla Tesla
msft Microsoft
amzn Amazon
xau Gold
oil Oil
EOF
}

v2_traders() {
  tr ',' '\n' <<< "${V2_TRADERS}"
}

# Exit 0 when the account already answers the view, so a deploy is skipped.
has_code() {
  local account="$1" method="$2" args="${3:-}"
  [[ -z "${args}" ]] && args='{}'
  set +e
  near_view "${account}" "${method}" "${args}" > /dev/null 2>&1
  local status=$?
  set -e
  return "${status}"
}

usdc() {
  python3 -c "import sys; print(int(float(sys.argv[1]) * 1_000_000))" "$1"
}

deposit_to() {
  local from="$1" amount="$2" msg="${3:-}"
  run near_call "${V2_TOKEN_ID}" ft_transfer_call "{\"receiver_id\":\"${V2_CONTRACT_ID}\",\"amount\":\"${amount}\",\"memo\":null,\"msg\":\"${msg}\"}" "${from}" "1 yoctoNEAR" "100 Tgas"
  show_tx "${LAST}"
}

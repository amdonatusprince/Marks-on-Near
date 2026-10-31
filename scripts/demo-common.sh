#!/usr/bin/env bash
# Helpers for the demo-market scripts. Source this. Do not execute it.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
PY="${ROOT}/scripts/json_get.py"

field() {
  printf '%s\n' "$1" | python3 "${PY}" "$2"
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

run() {
  set +e
  LAST="$("$@")"
  local status=$?
  set -e
  printf '%s\n' "${LAST}"
  if [[ "${status}" -ne 0 ]]; then
    exit "${status}"
  fi
}

require_demo() {
  : "${DEMO_CONTRACT_ID:?DEMO_CONTRACT_ID is missing. Run ./scripts/demo-accounts.sh}"
  : "${DEMO_ORACLE_ID:?DEMO_ORACLE_ID is missing. Run ./scripts/demo-accounts.sh}"
}

demo_markets() {
  cat <<'EOF'
NEAR-PERP crypto near
SOL-PERP crypto sol
ETH-PERP crypto eth
BTC-PERP crypto btc
BNB-PERP crypto bnb
GOLD-PERP metal xau
OIL-PERP energy oil
NVDA-PERP stock nvda
AAPL-PERP stock aapl
TSLA-PERP stock tsla
MSFT-PERP stock msft
AMZN-PERP stock amzn
EOF
}

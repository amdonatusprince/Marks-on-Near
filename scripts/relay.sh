#!/usr/bin/env bash
# Submit a gift claim or a faucet claim for someone else. AGENT_ID signs and
# pays the gas; its key stays in the keychain. The app's relayer routes call this.
#   ./scripts/relay.sh gift-claim <args.json>
#   ./scripts/relay.sh faucet <args.json>

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

KIND="${1:?gift-claim or faucet}"
ARGS="${2:?args file}"
[[ -f "${ARGS}" ]] || { echo "Missing the args file." >&2; exit 1; }

case "${KIND}" in
  gift-claim) RECEIVER="${V2_CONTRACT_ID}"; METHOD=claim_gift ;;
  faucet) RECEIVER="${V2_TOKEN_ID}"; METHOD=faucet ;;
  *) echo "Unknown relay ${KIND}" >&2; exit 1 ;;
esac

set +e
OUTPUT="$(near_call "${RECEIVER}" "${METHOD}" "${ARGS}" "${AGENT_ID}" "0 NEAR" "100 Tgas")"
STATUS=$?
set -e
if [[ "${STATUS}" -ne 0 ]]; then
  printf '%s\n' "${OUTPUT}" | grep -Eo 'Smart contract panicked: [^"]*|panicked at [^"]*' | head -1 >&2 || true
  printf '%s\n' "${OUTPUT}" | tail -5 >&2
  exit "${STATUS}"
fi
HASH="$(printf '%s\n' "${OUTPUT}" | grep -o 'Transaction ID: [A-Za-z0-9]*' | tail -1 | awk '{print $3}')"
[[ -n "${HASH}" ]] || { echo "The relay transaction did not return a hash." >&2; exit 1; }
printf 'HASH %s\n' "${HASH}"

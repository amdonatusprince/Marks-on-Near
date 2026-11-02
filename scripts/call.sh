#!/usr/bin/env bash
# Call one method. Use this when a testnet step fails and you want to rerun it alone.
#
# View:
#   ./scripts/call.sh view get_market '{"symbol":"NEAR-PERP"}'
#   ./scripts/call.sh view get_l2 '{"symbol":"NEAR-PERP","depth":5}'
#
# Change. The signer defaults to CONTRACT_ID from scripts/testnet.env:
#   ./scripts/call.sh call refresh_mark '{"symbol":"NEAR-PERP"}'
#
# The third argument may be a JSON object or a path to a .json file.

set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_testnet

KIND="${1:-}"
METHOD="${2:-}"
ARGS="${3:-}"
SIGNER="${4:-${CONTRACT_ID}}"

if [[ -z "${KIND}" || -z "${METHOD}" || -z "${ARGS}" ]]; then
  echo "Usage:" >&2
  echo "  ./scripts/call.sh view <method> <json-or-file>" >&2
  echo "  ./scripts/call.sh call <method> <json-or-file> [signer]" >&2
  exit 1
fi

case "${KIND}" in
  view)
    near_view "${CONTRACT_ID}" "${METHOD}" "${ARGS}"
    ;;
  call)
    echo "Calling ${METHOD} on ${CONTRACT_ID} as ${SIGNER}"
    near_call "${CONTRACT_ID}" "${METHOD}" "${ARGS}" "${SIGNER}"
    ;;
  *)
    echo "First argument must be view or call" >&2
    exit 1
    ;;
esac

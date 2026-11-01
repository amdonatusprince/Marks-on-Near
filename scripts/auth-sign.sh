#!/usr/bin/env bash
# Ask fast-auth.testnet to produce an MPC signature. The agent pays this call.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib.sh"
load_testnet

ARGS="${1:?args file}"
if [[ ! -f "${ARGS}" ]]; then
  echo "Missing the signature request." >&2
  exit 1
fi

redact() {
  sed -E 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[jwt]/g'
}

set +e
OUTPUT="$(near_call "fast-auth.testnet" sign "${ARGS}" "${AGENT_ID}" "1 yoctoNEAR" "300 Tgas")"
STATUS=$?
set -e
if [[ "${STATUS}" -ne 0 ]]; then
  printf '%s\n' "${OUTPUT}" | redact >&2
  exit "${STATUS}"
fi

HASH="$(printf '%s\n' "${OUTPUT}" | grep -Eo '(nearblocks\.io/txns/|transactions/)[A-Za-z0-9]+' | head -1 | awk -F/ '{print $NF}')"
if [[ -z "${HASH}" ]]; then
  echo "The signature transaction did not return a hash." >&2
  printf '%s\n' "${OUTPUT}" | redact >&2
  exit 1
fi
printf 'HASH %s\n' "${HASH}"

#!/usr/bin/env bash
# Shared helpers for the testnet scripts. Source this. Do not execute it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/scripts/testnet.env"
WASM="${ROOT}/contract/target/wasm32-unknown-unknown/release/marks.wasm"
NETWORK="testnet"

near_bin() {
  if command -v near >/dev/null 2>&1; then
    command -v near
    return
  fi
  local cached
  cached="$(find "${HOME}/.npm/_npx" -type f -path '*/near-cli-rs/node_modules/.bin_real/near' 2>/dev/null | head -1 || true)"
  if [[ -n "${cached}" ]]; then
    printf '%s\n' "${cached}"
    return
  fi
  printf '%s\n' "npx"
}

near_exec() {
  local bin
  bin="$(near_bin)"
  if [[ "${bin}" == "npx" ]]; then
    npx --yes near-cli-rs "$@"
  else
    "${bin}" "$@"
  fi
}

load_testnet() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing ${ENV_FILE}. Run ./scripts/create-accounts.sh first." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  : "${CONTRACT_ID:?CONTRACT_ID is required in scripts/testnet.env}"
  : "${COLLATERAL_ID:?COLLATERAL_ID is required in scripts/testnet.env}"
}

args_file() {
  local args="$1"
  if [[ -f "${args}" ]]; then
    printf '%s\n' "${args}"
    return
  fi
  local file
  file="$(mktemp "${TMPDIR:-/tmp}/marks-args.XXXXXX")"
  printf '%s\n' "${args}" > "${file}"
  printf '%s\n' "${file}"
}

near_view() {
  local contract="$1"
  local method="$2"
  local args="$3"
  local file
  file="$(args_file "${args}")"
  near_exec contract call-function as-read-only \
    "${contract}" "${method}" file-args "${file}" \
    network-config "${NETWORK}" now 2>&1
}

near_call() {
  local contract="$1"
  local method="$2"
  local args="$3"
  local signer="$4"
  local deposit="${5:-0 NEAR}"
  local gas="${6:-30 Tgas}"
  local file
  file="$(args_file "${args}")"
  near_exec contract call-function as-transaction \
    "${contract}" "${method}" file-args "${file}" \
    prepaid-gas "${gas}" \
    attached-deposit "${deposit}" \
    sign-as "${signer}" \
    network-config "${NETWORK}" \
    sign-with-keychain \
    send 2>&1
}

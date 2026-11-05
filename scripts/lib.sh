#!/usr/bin/env bash
# Shared helpers for the testnet scripts. Source this. Do not execute it.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
WASM="${ROOT}/contract/target/wasm32-unknown-unknown/release/marks.wasm"
NETWORK="testnet"

# Replace one key in .env, or append it. Other keys stay, including secrets.
env_set() {
  local key="$1" value="$2"
  python3 - "${ENV_FILE}" "${key}" "${value}" <<'PY'
import sys
from pathlib import Path

path, key, value = sys.argv[1:]
file = Path(path)
lines = file.read_text().splitlines() if file.exists() else []
prefixes = (f"{key}=", f"export {key}=")
out = []
found = False
for line in lines:
    if line.strip().startswith(prefixes):
        if not found:
            out.append(f"{key}={value}")
            found = True
        continue
    out.append(line)
if not found:
    if out and out[-1] != "":
        out.append("")
    out.append(f"{key}={value}")
file.write_text("\n".join(out).rstrip() + "\n")
PY
}

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
    echo "Missing ${ENV_FILE}. Copy .env.example to .env first." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  : "${CONTRACT_ID:?CONTRACT_ID is required in .env}"
  : "${COLLATERAL_ID:?COLLATERAL_ID is required in .env}"
  # The app stores the live v2 accounts once, under VITE_*. Scripts still say V2_*.
  V2_CONTRACT_ID="${V2_CONTRACT_ID:-${VITE_CONTRACT_ID:-}}"
  V2_ORACLE_ID="${V2_ORACLE_ID:-${VITE_ORACLE_ID:-}}"
  V2_TOKEN_ID="${V2_TOKEN_ID:-${VITE_TOKEN_ID:-}}"
  V2_FEE_ID="${V2_FEE_ID:-${V2_CONTRACT_ID:-}}"
  MARKS_RPC="${MARKS_RPC:-${VITE_TESTNET_RPC:-https://test.rpc.fastnear.com}}"
  INTENTS_RECIPIENT="${INTENTS_RECIPIENT:-${VITE_INTENTS_RECIPIENT:-marks.near}}"
  export V2_CONTRACT_ID V2_ORACLE_ID V2_TOKEN_ID V2_FEE_ID MARKS_RPC INTENTS_RECIPIENT
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

# The Mac signs with the login keychain. A container has no keychain, so the
# entrypoint writes ~/.near-credentials/testnet/<account>.json from MARKS_KEEPER_KEY.
near_sign_with() {
  local signer="$1"
  if [[ -f "${HOME}/.near-credentials/testnet/${signer}.json" ]]; then
    printf '%s\n' "sign-with-legacy-keychain"
    return
  fi
  printf '%s\n' "sign-with-keychain"
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
    "$(near_sign_with "${signer}")" \
    send 2>&1
}

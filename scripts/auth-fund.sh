#!/usr/bin/env bash
# Send 0.05 testnet NEAR to a new Google implicit account so it can pay gas.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib.sh"
load_testnet

ACCOUNT="${1:?account id}"
if [[ ! "${ACCOUNT}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The Google account id is not an implicit account." >&2
  exit 1
fi

yocto() {
  python3 - "$1" <<'PY'
import json, sys, urllib.request
account = sys.argv[1]
body = json.dumps({
    "jsonrpc": "2.0",
    "id": "1",
    "method": "query",
    "params": {"request_type": "view_account", "finality": "final", "account_id": account},
}).encode()
request = urllib.request.Request(
    "https://rpc.testnet.near.org",
    data=body,
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    payload = json.load(response)
if "error" in payload:
    cause = payload["error"].get("cause", {}).get("name", "")
    if cause == "UNKNOWN_ACCOUNT":
        print("0")
        raise SystemExit(0)
    print(json.dumps(payload["error"]), file=sys.stderr)
    raise SystemExit(2)
print(payload["result"]["amount"])
PY
}

at_least() {
  python3 -c 'import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)' "$1" "$2"
}

TARGET="$(yocto "${ACCOUNT}")"
# 0.02 NEAR is enough to skip another transfer.
if [[ "${TARGET}" != "0" ]] && at_least "${TARGET}" 20000000000000000000000; then
  echo "READY"
  exit 0
fi

AGENT="$(yocto "${AGENT_ID}")"
# Leave the quoting agent at least 2 NEAR.
if ! at_least "${AGENT}" 2000000000000000000000000; then
  echo "The testnet relayer account is below 2 NEAR." >&2
  exit 1
fi

# A brand-new implicit account is not on testnet yet. near-cli stops to ask
# "Do you want to proceed?" and, without a terminal, prints the warning and exits.
# The first choice is yes. Answer it, so the 0.05 NEAR creates the account.
BIN="$(near_bin)"
python3 - "$BIN" "${AGENT_ID}" "${ACCOUNT}" <<'PY'
import os
import pty
import select
import sys

binary, agent, account = sys.argv[1:]
command = [
    "npx",
    "--yes",
    "near-cli-rs",
] if binary == "npx" else [binary]
command += [
    "tokens",
    agent,
    "send-near",
    account,
    "0.05 NEAR",
    "network-config",
    "testnet",
    "sign-with-keychain",
    "send",
]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(command[0], command)
confirmed = False
pending = b""
while True:
    ready, _, _ = select.select([fd], [], [], 90)
    if not ready:
        os.kill(pid, 15)
        sys.stderr.write("The testnet transfer timed out.\n")
        sys.exit(1)
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    pending += chunk
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    if not confirmed and b"Do you want to proceed?" in pending:
        os.write(fd, b"\r")
        confirmed = True
os.close(fd)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
PY
echo "FUNDED"

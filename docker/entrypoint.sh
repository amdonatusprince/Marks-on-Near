#!/bin/bash
# Turn the container environment into the files the scripts already read.
# The secret stays in the environment and in root-only files. It is not logged.
set -euo pipefail
umask 077

export HOME=/root

if [[ -z "${BETTER_AUTH_SECRET:-}" || ${#BETTER_AUTH_SECRET} -lt 32 ]]; then
  echo "Set BETTER_AUTH_SECRET to a random string of at least 32 characters." >&2
  exit 1
fi
if [[ -z "${MARKS_KEEPER_KEY:-}" || -z "${AGENT_ID:-}" ]]; then
  echo "Set MARKS_KEEPER_KEY and AGENT_ID." >&2
  exit 1
fi

python3 - <<'PY'
import os
from pathlib import Path

names = """
PORT PING_MESSAGE
VITE_CONTRACT_ID VITE_ORACLE_ID VITE_TOKEN_ID VITE_INTENTS_RECIPIENT VITE_TESTNET_RPC
VITE_MAINNET_CONTRACT_ID
MARKS_KEEPER_ACCOUNT MARKS_KEEPER_KEY MARKS_KEEPER
BETTER_AUTH_SECRET BETTER_AUTH_URL
CONTRACT_ID COLLATERAL_ID TRADER_ID TAKER_ID AGENT_ID ORACLE_ID
SYMBOL CATEGORY TICK_SIZE INITIAL_MARGIN_BPS MAINTENANCE_MARGIN_BPS
MAX_FUNDING_BPS FUNDING_INTERVAL_NS STALE_AFTER_NS INSURANCE
DEMO_CONTRACT_ID DEMO_ORACLE_ID DEMO_TICK_SIZE DEMO_STALE_AFTER_NS
V2_TRADERS
NEAR_CLI_NETWORK
""".split()
lines = []
for name in names:
    value = os.environ.get(name, "")
    if not value or "\n" in value:
        continue
    lines.append(f"{name}={value}")
path = Path("/marks/.env")
path.write_text("\n".join(lines) + "\n")
os.chmod(path, 0o600)
PY

mkdir -p /root/.config/near-cli /marks/agent/data
cp /opt/marks/near-cli-config.toml /root/.config/near-cli/config.toml
node /opt/marks/write-key.mjs

cd /marks/agent
exec node .output/server/index.mjs

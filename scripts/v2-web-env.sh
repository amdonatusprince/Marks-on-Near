#!/usr/bin/env bash
# Point web/.env.local at the Marks v2 contract, oracle and token. Other lines stay as they are.
#   ./scripts/v2-web-env.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

python3 - "${ROOT}/web/.env.local" "${V2_CONTRACT_ID}" "${V2_ORACLE_ID}" "${V2_TOKEN_ID}" <<'PY'
import sys
from pathlib import Path

path, contract, oracle, token = sys.argv[1:]
file = Path(path)
lines = file.read_text().splitlines() if file.exists() else []
keys = ("NEXT_PUBLIC_CONTRACT_ID=", "NEXT_PUBLIC_ORACLE_ID=", "NEXT_PUBLIC_TOKEN_ID=")
kept = [line for line in lines if not line.startswith(keys)]
kept[:0] = [
    f"NEXT_PUBLIC_CONTRACT_ID={contract}",
    f"NEXT_PUBLIC_ORACLE_ID={oracle}",
    f"NEXT_PUBLIC_TOKEN_ID={token}",
]
file.write_text("\n".join(kept) + "\n")
PY

echo "web/.env.local points at ${V2_CONTRACT_ID}"

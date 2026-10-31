#!/usr/bin/env bash
# Create the demo feed and the twelve markets, then trade about 300 USDC
# on each. This appends account ids to scripts/testnet.env. It does not
# run create-accounts.sh and it does not replace the original market.
#
#   ./scripts/demo.sh
#   ./scripts/demo.sh --from-feed
#   ./scripts/demo.sh --from-list
#   ./scripts/demo.sh --from-trade

set -euo pipefail
source "$(dirname "$0")/demo-common.sh"

FROM="${1:-}"

if [[ "${FROM}" != "--from-feed" && "${FROM}" != "--from-list" && "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-accounts.sh"
  "${ROOT}/scripts/demo-oracle.sh"
fi

if [[ "${FROM}" != "--from-list" && "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-feed.sh"
fi

if [[ "${FROM}" != "--from-trade" ]]; then
  "${ROOT}/scripts/demo-list.sh"
fi

"${ROOT}/scripts/demo-trade.sh"

load_testnet
python3 - "${ROOT}/web/.env.local" "${DEMO_CONTRACT_ID}" "${DEMO_ORACLE_ID}" <<'PY'
import sys
from pathlib import Path

path, contract, oracle = sys.argv[1:]
file = Path(path)
lines = file.read_text().splitlines() if file.exists() else []
kept = [
    line
    for line in lines
    if not line.startswith("NEXT_PUBLIC_CONTRACT_ID=")
    and not line.startswith("NEXT_PUBLIC_ORACLE_ID=")
]
kept.insert(0, f"NEXT_PUBLIC_ORACLE_ID={oracle}")
kept.insert(0, f"NEXT_PUBLIC_CONTRACT_ID={contract}")
if not any(line.startswith("NEXT_PUBLIC_INTENTS_RECIPIENT=") for line in kept):
    kept.append("NEXT_PUBLIC_INTENTS_RECIPIENT=marks.near")
file.write_text("\n".join(kept) + "\n")
PY

echo "Board env points at ${DEMO_CONTRACT_ID}"
echo "Oracle: https://testnet.nearblocks.io/address/${DEMO_ORACLE_ID}"
echo "Marks: https://testnet.nearblocks.io/address/${DEMO_CONTRACT_ID}"

#!/usr/bin/env bash
# Point .env at the Marks v2 contract, oracle and token. Other lines stay.
#   ./scripts/v2-web-env.sh

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"
load_testnet
require_v2

env_set VITE_CONTRACT_ID "${V2_CONTRACT_ID}"
env_set VITE_ORACLE_ID "${V2_ORACLE_ID}"
env_set VITE_TOKEN_ID "${V2_TOKEN_ID}"
env_set VITE_INTENTS_RECIPIENT "${VITE_INTENTS_RECIPIENT:-marks.near}"

echo ".env points at ${V2_CONTRACT_ID}"

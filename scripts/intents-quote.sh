#!/usr/bin/env bash
# Ask NEAR Intents for a quote and spend nothing.
#
#   ./scripts/intents-quote.sh
#
# dry is true. The response has quote.amountOut and no deposit address.
# A live quote (dry false) spends real USDC on mainnet. This script does not send one.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECIPIENT="${INTENTS_RECIPIENT:-marks.near}"
DEADLINE="$(python3 -c 'from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc)+timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')"

BODY="$(cat <<EOF
{
  "dry": true,
  "swapType": "EXACT_INPUT",
  "slippageTolerance": 100,
  "originAsset": "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
  "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "amount": "1000000",
  "recipient": "${RECIPIENT}",
  "recipientType": "DESTINATION_CHAIN",
  "refundTo": "0x2527D02599Ba641c19FEa793cD0F167589a0f10D",
  "refundType": "ORIGIN_CHAIN",
  "deadline": "${DEADLINE}"
}
EOF
)"

echo "Requesting a dry quote for 1000000 origin atoms to ${RECIPIENT}"
RESPONSE="$(curl -sS -X POST "https://1click.chaindefuser.com/v0/quote" \
  -H "content-type: application/json" \
  -d "${BODY}")"
printf '%s\n' "${RESPONSE}" | python3 "${ROOT}/scripts/json_get.py" quote.amountOut >/tmp/marks-quote-out
AMOUNT="$(cat /tmp/marks-quote-out)"
if [[ -z "${AMOUNT}" || "${AMOUNT}" == "0" ]]; then
  echo "The quote did not include an output amount" >&2
  printf '%s\n' "${RESPONSE}" >&2
  exit 1
fi
if printf '%s\n' "${RESPONSE}" | grep -q '"depositAddress"'; then
  echo "A dry quote returned a deposit address" >&2
  exit 1
fi
echo "Output amount: ${AMOUNT}"

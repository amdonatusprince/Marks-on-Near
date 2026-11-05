#!/usr/bin/env bash
# Stand up Marks v2 on new accounts, end to end, then point the app at it.
#   ./scripts/v2.sh
#   ./scripts/v2.sh --from-deploy | --from-feed | --from-list | --from-seed | --from-exercise

set -euo pipefail
source "$(dirname "$0")/v2-common.sh"

FROM="${1:-}"
case "${FROM}" in
  "" | --from-deploy | --from-feed | --from-list | --from-seed | --from-exercise) ;;
  *)
    echo "Unknown flag ${FROM}" >&2
    exit 1
    ;;
esac

stage() {
  local order=(--from-accounts --from-deploy --from-feed --from-list --from-seed --from-exercise)
  local start="${FROM:---from-accounts}" want="$1" seen=0
  for item in "${order[@]}"; do
    [[ "${item}" == "${start}" ]] && seen=1
    if [[ "${item}" == "${want}" ]]; then
      return $((1 - seen))
    fi
  done
  return 1
}

stage --from-accounts && "${ROOT}/scripts/v2-accounts.sh"
stage --from-deploy && "${ROOT}/scripts/v2-deploy.sh"
stage --from-feed && "${ROOT}/scripts/v2-feed.sh"
stage --from-list && "${ROOT}/scripts/v2-list.sh"
stage --from-seed && "${ROOT}/scripts/v2-seed.sh"
stage --from-exercise && "${ROOT}/scripts/v2-exercise.sh"

"${ROOT}/scripts/v2-web-env.sh"

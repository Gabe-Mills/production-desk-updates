#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
echo "Production Desk · iPhone / iPad installer"
echo
status=0
/usr/bin/python3 "$SCRIPT_DIR/install-ios.py" "$@" || status=$?
if [[ -t 0 ]]; then
  echo
  read -r -p "Press Return to close…" _
fi
exit "$status"

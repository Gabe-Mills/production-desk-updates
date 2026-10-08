#!/bin/bash
# Builds with existing local signing assets only; never provisions or uploads.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$SOURCE_DIR/dist"
mode="${1:-install}"

case "$mode" in
  --check|--prepare|install) ;;
  *) echo "Usage: Prepare Production Desk.command [--check | --prepare]" >&2; exit 2 ;;
esac
if [[ $# -gt 1 ]]; then
  echo "Choose --check, --prepare, or open the launcher without arguments." >&2
  exit 2
fi
if ! xcrun --find xcodebuild >/dev/null 2>&1 || [[ ! -x /usr/bin/python3 ]]; then
  echo "Install Xcode on this Mac and open it once, then try again." >&2
  exit 1
fi
echo "Production Desk · local iPhone / iPad setup"
echo
status=0
prepare() {
  if [[ "$mode" == "--check" ]]; then
    "$SCRIPT_DIR/build-installer.sh" --check
    return
  fi
  "$SCRIPT_DIR/build-installer.sh" --output "$BUILD_DIR" || return $?
  if [[ "$mode" == "--prepare" ]]; then
    /usr/bin/python3 "$SCRIPT_DIR/install-ios.py" --ipa "$BUILD_DIR/ProductionDesk.ipa" --check
    return
  fi
  /usr/bin/python3 "$SCRIPT_DIR/install-ios.py" --ipa "$BUILD_DIR/ProductionDesk.ipa"
}
prepare || status=$?
if [[ -t 0 && "$mode" == "install" ]]; then
  echo
  read -r -p "Press Return to close…" _
fi
exit "$status"

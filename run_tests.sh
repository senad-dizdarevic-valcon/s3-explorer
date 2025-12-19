#!/usr/bin/env bash
# Portable repository test runner for local and CI parity
# Sections:
#  - Prerequisites (Node.js, npx)
#  - ESLint v8 (pinned 8.57.0) on ./assets/js
#  - Stylelint on CSS
#  - HTMLHint on index.html
# Exits non-zero on first failure (fail fast). Prints a summary on exit.

set -euo pipefail
# Auto-confirm npm/npx installs to avoid first-run npx install prompt in CI/non-interactive shells
export npm_config_yes=true

# -------------------------------
# Exit codes
# -------------------------------
EXIT_PREREQS=1
EXIT_ESLINT=2
EXIT_STYLELINT=3
EXIT_HTMLHINT=4

# -------------------------------
# Summary state (updated live)
# -------------------------------
ESLINT_RESULT="NOT RUN"
STYLELINT_RESULT="NOT RUN"
HTMLHINT_RESULT="NOT RUN"

# Track overall exit status; keep first failure's code
OVERALL_CODE=0

# -------------------------------
# Trap to always print summary
# -------------------------------
on_exit() {
  # Preserve the original exit code
  local code=$?
  printf "\n========================================\n"
  printf "Test Summary\n"
  printf "%s\n" "----------------------------------------"
  printf "ESLint:    %s\n" "$ESLINT_RESULT"
  printf "Stylelint: %s\n" "$STYLELINT_RESULT"
  printf "HTMLHint:  %s\n" "$HTMLHINT_RESULT"
  printf "%s\n" "----------------------------------------"
  if [ "$code" -eq 0 ]; then
    printf "Overall:   PASS\n"
  else
    printf "Overall:   FAIL (exit code %d)\n" "$code"
  fi
  printf "========================================\n"
  exit "$code"
}
trap on_exit EXIT

# -------------------------------
# Helpers
# -------------------------------
section() {
  printf "\n========== %s ==========\n" "$1"
}

require_cmd() {
  # $1 = command name, $2 = friendly name
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Error: '%s' is not installed or not found in PATH.\n" "$1" >&2
    printf "Action: Install %s and ensure '%s' is available in your PATH.\n" "$2" "$1" >&2
    exit "$EXIT_PREREQS"
  fi
}

# -------------------------------
# 1) Prerequisites
# -------------------------------
section "Checking prerequisites"
require_cmd node "Node.js (https://nodejs.org)"
require_cmd npx "npx (comes with Node.js/npm)"

# -------------------------------
# ESLint configuration (warnings policy)
# -------------------------------
# If ALLOW_WARNINGS=1 is set, relax ESLint warnings threshold.
ESLINT_MAX_WARNINGS=0
if [ "${ALLOW_WARNINGS:-0}" = "1" ]; then
  ESLINT_MAX_WARNINGS=999999
fi

# -------------------------------
# 2a) ESLint v8 (pinned)
# -------------------------------
section "Running ESLint (v8.57.0) on ./assets/js"
printf "ALLOW_WARNINGS=%s, --max-warnings=%s\n" "${ALLOW_WARNINGS:-0}" "$ESLINT_MAX_WARNINGS"

if npx eslint@8.57.0 ./assets/js --max-warnings="$ESLINT_MAX_WARNINGS"; then
  ESLINT_RESULT="PASS"
else
  ESLINT_RESULT="FAIL"
  if [ "$OVERALL_CODE" -eq 0 ]; then OVERALL_CODE="$EXIT_ESLINT"; fi
fi

# -------------------------------
# 2b) Stylelint on CSS
# -------------------------------
section "Running Stylelint on assets/css/**/*.css"
if npx stylelint "assets/css/**/*.css"; then
  STYLELINT_RESULT="PASS"
else
  STYLELINT_RESULT="FAIL"
  if [ "$OVERALL_CODE" -eq 0 ]; then OVERALL_CODE="$EXIT_STYLELINT"; fi
fi

# -------------------------------
# 2c) HTMLHint on index.html
# -------------------------------
section "Running HTMLHint on index.html"
if npx htmlhint index.html; then
  HTMLHINT_RESULT="PASS"
else
  HTMLHINT_RESULT="FAIL"
  if [ "$OVERALL_CODE" -eq 0 ]; then OVERALL_CODE="$EXIT_HTMLHINT"; fi
fi

# If all checks passed, script reaches natural end (exit 0).
exit "$OVERALL_CODE"
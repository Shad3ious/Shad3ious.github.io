#!/usr/bin/env bash
# Version: 1
#
# Synopsis:
#   Checks files before they are committed to this public repo.
#   BLOCKS the commit on: private keys, known token formats (GitHub, Vault, AWS,
#   Slack, Google, JWT), and anything in your private denylist.
#   WARNS (does not block) on: password-looking assignments, plaintext
#   ConvertTo-SecureString, private IP addresses, internal-looking domain names,
#   and UNC paths. Example values in guides are fine; check each warning anyway.
#
# Usage:
#   Install as a git hook (once, from the repo root):
#     cp tools/pre-publish-scan_v1.sh .git/hooks/pre-commit
#     chmod +x .git/hooks/pre-commit
#   Scan the whole repo by hand:
#     bash tools/pre-publish-scan_v1.sh --all
#   Private denylist (internal hostnames, domains, names - NEVER commit this file):
#     ~/.config/shad3ious-docs/denylist.txt   one plain-text term per line, # for comments
#   Skip the check for one commit, only after reviewing the findings:
#     git commit --no-verify

set -uo pipefail

DENYLIST="${HOME}/.config/shad3ious-docs/denylist.txt"
MODE="staged"
if [ "${1:-}" = "--all" ]; then
  MODE="all"
fi

# Third-party files that are verified separately and not worth scanning.
skip_path() {
  case "$1" in
    assets/vendor/*|assets/fonts/*|*.woff2|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico) return 0 ;;
    *) return 1 ;;
  esac
}

# name|extended-regex
BLOCK_RULES=(
  "Private key|-----BEGIN [A-Z ]*PRIVATE KEY-----"
  "GitHub token|(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})"
  "Vault token|\bhv[sbr]\.[A-Za-z0-9_-]{20,}"
  "AWS access key|\b(AKIA|ASIA)[0-9A-Z]{16}\b"
  "Slack token|xox[abprs]-[A-Za-z0-9-]{10,}"
  "Google API key|AIza[0-9A-Za-z_-]{35}"
  "JWT|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
)

WARN_RULES=(
  "Password-style assignment|(password|passwd|pwd|secret|token|api[_-]?key)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][^\"'\$<{[:space:]]{6,}[\"']"
  "Plaintext ConvertTo-SecureString|ConvertTo-SecureString[[:space:]]+[\"'][^\"']+[\"']"
  "Private IP address|\b(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})\b"
  "Internal-looking domain|\b[A-Za-z0-9-]+\.(local|lan|corp|internal|intranet|home\.arpa)\b"
  "UNC path|\\\\\\\\[A-Za-z0-9._-]+\\\\[A-Za-z0-9.\$_-]+"
)

blocked=0
warned=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Load denylist terms (skip blanks and comments).
deny_terms=""
if [ -f "$DENYLIST" ]; then
  deny_terms="$(grep -v -E '^[[:space:]]*(#|$)' "$DENYLIST" || true)"
fi

scan_file() {
  local path="$1" src="$2" rule name regex hits

  for rule in "${BLOCK_RULES[@]}"; do
    name="${rule%%|*}"; regex="${rule#*|}"
    hits="$(grep -n -I -E -- "$regex" "$src" 2>/dev/null | cut -d: -f1 | tr '\n' ' ')"
    if [ -n "$hits" ]; then
      # Line numbers only: never echo a secret back to the terminal.
      echo "BLOCK  $path  line(s) ${hits}- $name"
      blocked=1
    fi
  done

  if [ -n "$deny_terms" ]; then
    hits="$(printf '%s\n' "$deny_terms" | grep -n -I -i -F -f - "$src" 2>/dev/null | cut -d: -f1 | tr '\n' ' ')"
    if [ -n "$hits" ]; then
      echo "BLOCK  $path  line(s) ${hits}- matches your private denylist"
      blocked=1
    fi
  fi

  for rule in "${WARN_RULES[@]}"; do
    name="${rule%%|*}"; regex="${rule#*|}"
    hits="$(grep -n -I -i -E -- "$regex" "$src" 2>/dev/null | cut -d: -f1 | tr '\n' ' ')"
    if [ -n "$hits" ]; then
      # Line numbers only, same as BLOCK: matched text is never printed.
      echo "warn   $path  line(s) ${hits}- $name"
      warned=1
    fi
  done
}

if [ "$MODE" = "all" ]; then
  while IFS= read -r -d '' f; do
    skip_path "$f" && continue
    [ -f "$f" ] || continue
    scan_file "$f" "$f"
  done < <(git ls-files -z)
else
  while IFS= read -r -d '' f; do
    skip_path "$f" && continue
    # Scan the staged version, which is exactly what will be committed.
    git show ":$f" > "$tmp" 2>/dev/null || continue
    scan_file "$f" "$tmp"
  done < <(git diff --cached --name-only --diff-filter=ACMR -z)
fi

if [ ! -f "$DENYLIST" ]; then
  echo "note   No private denylist at $DENYLIST - internal names are not being checked."
fi

if [ "$blocked" -ne 0 ]; then
  echo ""
  echo "Commit blocked. Remove the flagged values, then commit again."
  echo "If a secret was ever pushed, rotate it: deleting it from the repo does not make it safe."
  exit 1
fi

if [ "$warned" -ne 0 ]; then
  echo ""
  echo "Warnings only. Make sure each one is a made-up example (contoso.com style), not a real value."
fi
exit 0

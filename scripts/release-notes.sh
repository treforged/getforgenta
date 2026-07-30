#!/usr/bin/env bash
#
# Build Google Play "What's new" notes from commit subjects.
#
# Usage:
#   scripts/release-notes.sh <git-range>      # e.g. abc123..def456, or -6
#   git log --format=%s | scripts/release-notes.sh --stdin
#
# Writes the notes to stdout. Exit code is always 0: a release must never fail
# because its notes could not be generated, hence the evergreen fallback.
#
# Why this exists: the previous inline version pasted raw commit subjects into
# the store listing and byte-truncated the result. A real release shipped with
# "- Docs: handoff - session 32; items 1-3 (upload CSP, DNT/GPC, ...)" followed
# by a line cut mid-word ("- [p"). Two separate faults, both fixed here:
#   1. Internal commits are no longer eligible at all (type + jargon filters).
#   2. Truncation happens on whole lines and on word boundaries, never bytes.

set -uo pipefail

# Google Play allows 500 characters per locale. Stay under it rather than at it.
readonly MAX_TOTAL=480
# A single note longer than this is a commit subject doing too much; trim it.
readonly MAX_LINE=100
# Most users skim three or four lines.
readonly MAX_NOTES=5

readonly FALLBACK="Small optimizations compound over time, same principle your budget runs on. This release clears a few debts in our codebase: performance improvements, stability fixes, and a smoother experience under the hood."

# Commit types that describe user-visible change. Everything else (chore, docs,
# test, ci, build, refactor, style, revert, wip) is internal by definition.
readonly PUBLIC_TYPES='feat|fix|perf'

# Scopes that are not the shipped app. A feat/fix here is real work, but it is
# not something a Play Store reader installed the app to hear about. The Reddit
# scout and the marketing generator are internal tooling; deps/ci/security are
# housekeeping whose detail belongs in the repo, not the listing.
readonly INTERNAL_SCOPES='reddit-scout|reddit|scout|marketing|deps|deps-dev|ci|build|infra|tooling|docs|test|release|security'

# Substrings that mark a subject as internal even when type and scope look fine.
# Matched case-insensitively against the cleaned subject.
readonly JARGON='handoff|session [0-9]|fixture|snapshot|backup|typecheck|tsc |eslint|lint|pg_net|codeql|dependabot|lockfile|package-lock|node_modules|refactor|regression test|unit test|coverage|stub|scaffold|migration|edge function|cron|webhook|env var|feature flag|debug|logging|telemetry|merge branch|cherry-pick|bump |revert|user-agent|403|api key|sdk|advisor[iy]|placeholder|digest|claude|opus|gemini|anthropic|supabase|plaid token|react-router|npm|vite'

collect_subjects() {
  if [ "${1:-}" = "--stdin" ]; then
    cat
  else
    git log "$1" --format='%s' 2>/dev/null || true
  fi
}

# Turn a commit subject into a user-facing note, or print nothing to reject it.
clean_subject() {
  local s="$1"

  # Reject anything that is not a public type. Accepts "feat:", "feat(scope):"
  # and the repo's older "[scope]:" style is handled below.
  if ! printf '%s' "$s" | grep -qiE "^(${PUBLIC_TYPES})(\([^)]*\))?!?:"; then
    return 0
  fi

  # Reject internal scopes before stripping the prefix, while the scope is still
  # readable. Without this, tooling commits such as fix(reddit-scout) sail
  # through the type filter and end up in the store listing.
  local scope
  scope=$(printf '%s' "$s" | sed -nE 's/^[a-zA-Z]+\(([^)]*)\).*/\1/p')
  if [ -n "$scope" ] && printf '%s' "$scope" | grep -qiE "^(${INTERNAL_SCOPES})$"; then
    return 0
  fi

  # Strip the conventional-commit prefix, including any scope.
  s=$(printf '%s' "$s" | sed -E "s/^(${PUBLIC_TYPES})(\([^)]*\))?!?:[[:space:]]*//I")

  # Keep only the headline. Commit subjects in this repo often carry a trailing
  # clause after ';' or an em/en dash that is written for developers.
  s=$(printf '%s' "$s" | sed -E 's/[;] .*$//')
  s=$(printf '%s' "$s" | sed -E 's/ (—|–|--) .*$//')

  # Drop trailing parentheticals, which are almost always ticket ids or notes.
  s=$(printf '%s' "$s" | sed -E 's/[[:space:]]*\([^)]*\)[[:space:]]*$//')

  # Drop bracketed prefixes such as "[auth]:" or "[p".
  s=$(printf '%s' "$s" | sed -E 's/^\[[^]]*\]:?[[:space:]]*//')

  # Collapse whitespace and strip a trailing period.
  s=$(printf '%s' "$s" | tr -s '[:space:]' ' ' | sed -E 's/^ //; s/ $//; s/\.$//')

  # Reject internal work and anything too short to read as a sentence.
  if printf '%s' "$s" | grep -qiE "${JARGON}"; then return 0; fi
  if [ "${#s}" -lt 12 ]; then return 0; fi

  # Reject leftovers that are not prose: no lowercase letters, or unbalanced
  # brackets from a subject that was already truncated somewhere upstream.
  case "$s" in *'['*|*']'*|*'('*|*')'*) return 0 ;; esac

  # Trim to MAX_LINE on a word boundary. Never cut mid-word.
  if [ "${#s}" -gt "$MAX_LINE" ]; then
    s=$(printf '%s' "${s:0:$MAX_LINE}" | sed -E 's/ [^ ]*$//')
    s="${s}…"
  fi

  # Sentence case the first character.
  printf '%s%s\n' "$(printf '%s' "${s:0:1}" | tr '[:lower:]' '[:upper:]')" "${s:1}"
}

main() {
  local subjects notes='' count=0 line note total=0

  subjects=$(collect_subjects "${1:--6}")

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    note=$(clean_subject "$line")
    [ -n "$note" ] || continue

    # Skip duplicates — the same fix often lands across several commits.
    case "
$notes" in *"
- $note"*) continue ;; esac

    # Only append while the whole block still fits. Because we test the
    # assembled length before committing to a line, output is never cut short.
    local candidate="- $note"
    total=$(( ${#notes} + ${#candidate} + 1 ))
    [ "$total" -le "$MAX_TOTAL" ] || break

    notes="${notes}${candidate}"$'\n'
    count=$(( count + 1 ))
    [ "$count" -lt "$MAX_NOTES" ] || break
  done <<EOF
$subjects
EOF

  if [ "$count" -eq 0 ]; then
    printf '%s\n' "${FALLBACK:0:$MAX_TOTAL}"
  else
    printf '%s' "$notes"
  fi
}

main "$@"

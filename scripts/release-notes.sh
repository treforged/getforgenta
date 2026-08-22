#!/usr/bin/env bash
#
# COMPATIBILITY SHIM. The generator now lives in scripts/release-notes.mjs, with
# its logic in scripts/lib/release-notes.mjs and its tests in
# scripts/lib/__tests__/release-notes.test.mjs.
#
# WHY IT MOVED (2026-08-22). The bash version could only ever REJECT commit
# subjects; anything that survived its filters was published to the Google Play
# production listing verbatim. Every line of the live 6.4.0 listing passed every
# one of those filters, including:
#
#     - The $2 above the floor is the cushion, not surplus the cards could not absorb
#
# A rejection filter cannot write a customer sentence, which is what a store
# listing needs. The replacement prefers a `Release-Note:` trailer written by a
# person, derives pre-written themed sentences when there is none, and never
# publishes a commit subject at all. It is also testable, which this file never
# was: there was no test for it.
#
# This shim stays so that the documented CLI keeps working from anywhere:
#   scripts/release-notes.sh <git-range>
#   git log --format=%s | scripts/release-notes.sh --stdin
#
# Output contract is unchanged: notes on stdout, always 20..480 bytes, exit 0.

set -uo pipefail

exec node "$(dirname "$0")/release-notes.mjs" "$@"

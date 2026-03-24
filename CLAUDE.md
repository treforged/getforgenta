# CLAUDE.md

## Purpose

This repository is a real Git repository connected to GitHub. Treat it
like a production-adjacent project. Make requested changes carefully,
preserve existing working behavior unless explicitly asked to refactor,
and prioritize safety, clarity, reviewability, secure defaults, and
reliable local backups.

------------------------------------------------------------------------

## Default workflow

When I ask for changes in this repository, follow this default behavior
unless I explicitly say otherwise:

1.  Use Ruflo first when available and relevant.
2.  Make the requested code or file changes.
3.  Review the changed files and keep the diff scoped to the request.
4.  Create a local backup copy in the backup folder before finishing.
5.  Create a local git commit automatically after changes are complete.
6.  Do not push to GitHub, open a PR, merge branches, or rewrite history
    unless I explicitly ask.
7.  After finishing, summarize:
    -   which files changed
    -   what changed
    -   where the backup was saved
    -   the commit message used
    -   any risks, follow-ups, or manual checks
    -   the exact command I should run if I want to push

------------------------------------------------------------------------

## Ruflo-first behavior

Ruflo is the default orchestration layer.

-   Always prefer Ruflo when available.
-   Use multi-agent swarms for complex tasks.
-   Use simple edits only when clearly sufficient.
-   Still follow commit + backup rules.

------------------------------------------------------------------------

## Local commit policy

-   Always commit locally after edits.
-   Never push unless explicitly asked.

------------------------------------------------------------------------

## Backup policy

-   Save backups in ./backups/
-   Use timestamped folders
-   Never overwrite previous backups

------------------------------------------------------------------------

## Security rules

Never expose: - API keys - tokens - passwords - .env contents

Always use placeholders like: YOUR_API_KEY_HERE

------------------------------------------------------------------------

## Final rule

Use Ruflo → make changes → backup → commit → STOP (no push)

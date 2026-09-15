# ⚠️ `index.ts` IN THIS FOLDER IS **NOT** WHAT IS DEPLOYED

Production `reddit-scout` was replaced with a **tombstone** on 2026-09-15 (version 39) to close a
live credential exposure. `index.ts` beside this file is the REAL body, kept deliberately: it is
the undo path, not the deployed artefact.

## Why

The deployed function was reachable from the public internet and its only guard was an
`x-webhook-secret` header checked against `REDDIT_SCOUT_SECRET` — a value that had sat as a
**literal string** in `cron.job.command` on three jobs and is therefore **burned** (ask
`e72a8df4`). The body behind that guard reads `ANTHROPIC_API_KEY`, `RESEND_API_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`.

Nothing schedules it: 8 active cron jobs at the time of the deploy, none mentioning reddit,
checked in the same query as a positive control.

## ⚠️ `verify_jwt: true` WAS NOT THE FIX, AND THIS IS THE PART WORTH REMEMBERING

It had already been switched on (version 38) before this deploy, and the exposure was still open.
**The project's publishable anon key IS a valid JWT for this project, and it ships in the web
client**, so `verify_jwt: true` still admits anyone who has read the frontend.

Measured after the tombstone deploy, which is what proves the reach was real:

| request | result |
| --- | --- |
| `Authorization: Bearer <public anon key>` | **410** — it got through to the function body |
| no `Authorization` header | 401 `UNAUTHORIZED_NO_AUTH_HEADER` |
| control: another live function | answered normally, so requests do reach functions |

A 410 from the anon key means the caller reached the code. Before version 39 that code read three
credentials.

**So do not read `verify_jwt: true` as "authenticated users only".** It means "presents a JWT this
project signed", and the anon key qualifies. A function that must not be public needs its own
check on the caller's identity, not this flag alone.

## Undo

`supabase functions deploy reddit-scout` from this folder restores the real body (also in git at
commit `1a5a96ff`).

**DO NOT restore it until `REDDIT_SCOUT_SECRET` has been rotated.** Redeploying without rotating
puts the same three credentials back behind the same burned guard.

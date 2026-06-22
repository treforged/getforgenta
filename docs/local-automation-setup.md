# Local Automation Setup — Forgenta Backup Sync & Reddit Scout

Two recurring local jobs run on this machine, both via Windows Task Scheduler,
both weekly on Thursdays at 9:00 PM (same time slot, registered separately).
This doc is the rebuild reference — read this if either job needs to be set
up again from scratch (clean Windows reinstall, or a future move to macOS).

## 1. Forgenta Backup Sync

**What it does:** uploads any new `backups/<timestamp>/` snapshot to a
"Forgenta Local Backups" Google Drive folder, deletes local copies older
than 14 days once their upload is confirmed, then refreshes the graphify
knowledge graph and mirrors it into the Obsidian vault.

**Files (already in the repo):**
- `scripts/backup_drive_sync.py` — upload + prune logic. Pure Python, no
  Windows-specific calls, runs unchanged on macOS/Linux.
- `scripts/daily-backup-and-sync.ps1` — wrapper: runs the Python script,
  then `sync-graph-to-obsidian.ps1`.
- `scripts/sync-graph-to-obsidian.ps1` — pre-existing graphify update +
  Obsidian vault copy (predates this automation).
- `scripts/register-backup-sync-task.ps1` — one-time Task Scheduler
  registration.

**Dependencies:**
- Python 3.10+ with `google-api-python-client`, `google-auth-oauthlib`,
  `google-auth-httplib2`: `pip install -r tre-forged-marketing/requirements.txt`
- OAuth credentials at `tre-forged-marketing/memory/gdrive_credentials.json`
  (a Google Cloud "Desktop app" OAuth client — see
  `tre-forged-marketing/src/gdrive.py`'s `_MISSING_CREDS_MSG` for the
  console.cloud.google.com setup steps) and a `gdrive_token.json` generated
  by the first interactive run. Both are gitignored — they do **not** travel
  with the repo and must be recreated per machine.

### Windows (current setup)

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\register-backup-sync-task.ps1"
```

Verify: `schtasks /query /tn "Forgenta Backup Sync" /v /fo list`

### macOS (future machine)

Easiest path: install PowerShell Core so the existing `.ps1` scripts run
unchanged — no rewrite needed.

```bash
brew install --cask powershell
brew install python node
```

1. Copy/clone the repo to its new path (e.g. `~/Desktop/getforgenta`).
2. Edit the hardcoded repo/vault paths at the top of:
   - `scripts/daily-backup-and-sync.ps1` (`$RepoDir`)
   - `scripts/sync-graph-to-obsidian.ps1` (`$RepoDir`, `$GraphDir` — the
     Obsidian vault location will differ on the new machine)
3. Recreate the gitignored OAuth files, then run the flow once interactively
   to mint a token for the new machine:
   ```bash
   cd tre-forged-marketing && pip install -r requirements.txt
   python -c "import sys; sys.path.insert(0,'src'); from gdrive import _get_service; _get_service()"
   ```
   This opens a browser once for consent; after that it self-refreshes.
4. Create a launchd job (the macOS equivalent of Task Scheduler) at
   `~/Library/LaunchAgents/com.treforged.backupsync.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key><string>com.treforged.backupsync</string>
     <key>ProgramArguments</key>
     <array>
       <string>/usr/local/bin/pwsh</string>
       <string>-File</string>
       <string>/Users/YOUR_USERNAME/Desktop/getforgenta/scripts/daily-backup-and-sync.ps1</string>
     </array>
     <key>StartCalendarInterval</key>
     <dict>
       <key>Weekday</key><integer>4</integer>
       <key>Hour</key><integer>21</integer>
       <key>Minute</key><integer>0</integer>
     </dict>
     <key>StandardOutPath</key><string>/Users/YOUR_USERNAME/Desktop/getforgenta/scripts/backup-drive-sync.log</string>
     <key>StandardErrorPath</key><string>/Users/YOUR_USERNAME/Desktop/getforgenta/scripts/backup-drive-sync.log</string>
   </dict>
   </plist>
   ```
   (`Weekday 4` = Thursday; launchd numbers Sunday=0/7 through Saturday=6.)
   ```bash
   launchctl load ~/Library/LaunchAgents/com.treforged.backupsync.plist
   ```
   Verify: `launchctl list | grep backupsync`

   Caveat: Windows Task Scheduler's `-StartWhenAvailable` auto-catches-up a
   missed run; launchd's `StartCalendarInterval` does not — it just waits
   for the next Thursday 9PM. If the Mac is regularly asleep then, swap to
   `StartInterval` (e.g. every 6 hours) and have the script check "has it
   been >= 7 days since the last successful run" before doing anything.

## 2. Reddit Scout

**What it does:** scans 5 subreddits for relevant posts, drafts replies via
Gemini, and emails a digest via Resend. Full operational detail in the
`marketing-reddit-scout` memory; this section is just the scheduler setup.

**Files (already in the repo):**
- `scripts/reddit-scout.mjs` — the actual scan/draft/email logic (Node.js,
  cross-platform as-is).
- `scripts/reddit-scout.bat` — Windows wrapper: `cd` to repo, run the script,
  append output to the log.
- `scripts/setup-scheduler.ps1` — one-time Task Scheduler registration.
- `scripts/.scout-env` (gitignored, real keys) / `scripts/.scout-env.example`
  (template: `GEMINI_API_KEY`, `RESEND_API_KEY`).

### Windows (current setup)

```powershell
powershell -ExecutionPolicy Bypass -File "scripts\setup-scheduler.ps1"
```

Verify: `schtasks /query /tn "ForgentaRedditScout" /v /fo list`

### macOS (future machine)

No PowerShell needed here — the underlying job is just Node, so a native
shell wrapper is simplest.

1. `brew install node` (if not already done above).
2. Copy `scripts/.scout-env.example` to `scripts/.scout-env` and fill in real
   keys (gitignored, never commit this file).
3. Create `scripts/reddit-scout.sh`:
   ```bash
   #!/bin/bash
   cd "$(dirname "$0")/.." || exit 1
   node scripts/reddit-scout.mjs >> scripts/reddit-scout.log 2>&1
   ```
   ```bash
   chmod +x scripts/reddit-scout.sh
   ```
4. Create `~/Library/LaunchAgents/com.treforged.redditscout.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key><string>com.treforged.redditscout</string>
     <key>ProgramArguments</key>
     <array>
       <string>/Users/YOUR_USERNAME/Desktop/getforgenta/scripts/reddit-scout.sh</string>
     </array>
     <key>StartCalendarInterval</key>
     <dict>
       <key>Weekday</key><integer>4</integer>
       <key>Hour</key><integer>21</integer>
       <key>Minute</key><integer>0</integer>
     </dict>
   </dict>
   </plist>
   ```
   ```bash
   launchctl load ~/Library/LaunchAgents/com.treforged.redditscout.plist
   ```
   Verify: `launchctl list | grep redditscout`

   Same catch-up caveat as above applies — launchd won't retroactively run
   a missed Thursday slot.

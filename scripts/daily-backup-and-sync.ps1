param()

# Entry point for the daily "Forgenta Backup Sync" Windows Scheduled Task.
# 1. Uploads any new backups/<timestamp>/ folders to Google Drive and prunes
#    local copies older than 14 days that are already confirmed uploaded.
# 2. Refreshes the graphify knowledge graph and mirrors it into the Obsidian
#    vault, so project history stays captured there even as raw local
#    backups get pruned.

# PATHS ARE DERIVED, NEVER HARDCODED. This file pointed at
# C:\Users\tvonh\Desktop\getforgenta until 2026-09-02 and had been Set-Location-ing into a
# folder that no longer existed since the 08-27 move. The task reported
# LastTaskResult 0 the whole time, so a DAILY backup silently did nothing for six
# days while looking healthy. A new absolute path would just break on the next
# move; $PSScriptRoot cannot.
if (-not $PSScriptRoot) {
    # Split-Path THROWS on an empty string, so this guard has to come first - a
    # check written after the call can never fire.
    throw "daily-backup-and-sync.ps1 must be run as a file (PSScriptRoot is empty)."
}
$RepoDir = Split-Path -Parent $PSScriptRoot
Set-Location $RepoDir

python "$RepoDir\scripts\backup_drive_sync.py" 2>&1

& "$RepoDir\scripts\sync-graph-to-obsidian.ps1"

param()

# Entry point for the daily "Forgenta Backup Sync" Windows Scheduled Task.
# 1. Uploads any new backups/<timestamp>/ folders to Google Drive and prunes
#    local copies older than 14 days that are already confirmed uploaded.
# 2. Refreshes the graphify knowledge graph and mirrors it into the Obsidian
#    vault, so project history stays captured there even as raw local
#    backups get pruned.

$RepoDir = "C:\Users\tvonh\Desktop\getforgenta"
Set-Location $RepoDir

python "$RepoDir\scripts\backup_drive_sync.py" 2>&1

& "$RepoDir\scripts\sync-graph-to-obsidian.ps1"

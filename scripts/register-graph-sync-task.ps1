param()

# One-time setup: registers the "Forgenta Graph Sync" Windows Scheduled Task
# that runs scripts/sync-graph-to-obsidian.ps1 once a day. Re-run this if the
# task is ever deleted or needs re-registering (e.g. after moving the repo).
#
# Why a dedicated task: the graph was previously refreshed only as step 2 of
# the weekly "Forgenta Backup Sync" (Thursdays 9:00 PM), so it could sit up to
# a week stale. The rebuild is cheap and self-skipping when no .ts/.tsx file
# changed, so a daily cadence costs nothing on quiet days.
#
# The weekly backup task still calls the same script; that call is now
# normally a no-op and stays in place as a fallback.

$TaskName = "Forgenta Graph Sync"
$ScriptPath = "C:\Users\tvonh\Desktop\getforgenta\scripts\sync-graph-to-obsidian.ps1"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Daily at 8:00 PM - an hour before the backup sync slot so the two never
# contend for the repo, and late enough to capture a day's edits.
$Trigger = New-ScheduledTaskTrigger -Daily -At 8:00PM

$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Rebuilds the graphify knowledge graph when src/ or supabase/ changed and mirrors GRAPH_REPORT.md + wiki/ into the Obsidian vault. Logs to scripts/graph-sync.log." `
    -Force

Write-Output "Registered scheduled task '$TaskName' (daily at 8:00 PM, runs ASAP if missed)."

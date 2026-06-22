param()

# One-time setup: registers the "Forgenta Backup Sync" Windows Scheduled Task
# that runs scripts/daily-backup-and-sync.ps1 once a day. Re-run this if the
# task is ever deleted or needs re-registering (e.g. after moving the repo).

$TaskName = "Forgenta Backup Sync"
$ScriptPath = "C:\Users\tvonh\Desktop\getforgenta\scripts\daily-backup-and-sync.ps1"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Matches ForgentaRedditScout's schedule (weekly, Thursdays, 9:00 PM) - see
# marketing_reddit_scout memory / scripts/setup-scheduler.ps1.
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 9:00PM

$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Uploads getforgenta/backups/ snapshots to Google Drive and prunes local copies older than 14 days; refreshes graphify + Obsidian sync." `
    -Force

Write-Output "Registered scheduled task '$TaskName' (weekly, Thursdays at 9:00 PM - same slot as ForgentaRedditScout, runs ASAP if missed)."

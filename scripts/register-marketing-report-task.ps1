param()

# One-time setup: registers the "Forgenta Marketing Report" Windows Scheduled
# Task that posts the previous week's marketing numbers to the Conductor board
# every Monday morning.
#
# Why Monday 8:00 AM: the report covers the week that just ended, so it has to
# run after that week is over, and it wants to land before the week's posting
# starts rather than after. It is deliberately an hour before anything else on
# this machine touches the repo.
#
# The report never invents a number. Any metric with no row prints "no reading"
# and the report lists exactly where to go and read it, so a Monday with an
# empty counts file still produces a useful five-minute task rather than a
# dashboard of confident zeroes.
#
# Re-run this if the task is deleted or the repo moves.

$TaskName = "Forgenta Marketing Report"
$Repo = "C:\Users\tvonh\Desktop\getforgenta"
$Node = "C:\Program Files\nodejs\node.exe"
$Log = "$Repo\scripts\marketing-report.log"

if (-not (Test-Path $Node)) {
    Write-Error "node.exe not found at $Node. Fix the path in this script before registering."
    exit 1
}

# `--post` files it on the board; stdout is appended to a log so a failed post
# still leaves the report somewhere readable.
$Command = "& '$Node' '$Repo\scripts\marketing-report.mjs' --post *>> '$Log'"

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"$Command`"" `
    -WorkingDirectory $Repo

$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:00AM

$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "Posts last week's Forgenta marketing report to the Conductor board every Monday at 8 AM. Reads marketing/metrics/counts.csv (gitignored). Logs to scripts/marketing-report.log." `
    -Force

Write-Output "Registered scheduled task '$TaskName' (Mondays 8:00 AM, runs ASAP if missed)."
Write-Output "Test it now with:  node `"$Repo\scripts\marketing-report.mjs`" --post"

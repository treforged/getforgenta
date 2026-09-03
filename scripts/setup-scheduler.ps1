# Derived, not hardcoded - the same trap as the other two register scripts:
# re-running this with a stale absolute path re-registers a broken task.
if (-not $PSScriptRoot) {
    throw "setup-scheduler.ps1 must be run as a file (PSScriptRoot is empty)."
}
$batPath = Join-Path $PSScriptRoot "reddit-scout.bat"
if (-not (Test-Path $batPath)) {
    throw "Refusing to register a task against a script that is not there: $batPath"
}
$action = New-ScheduledTaskAction -Execute $batPath
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 9pm
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "ForgentaRedditScout" -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force
Write-Host "Done. Task registered." -ForegroundColor Green
Start-Sleep -Seconds 3

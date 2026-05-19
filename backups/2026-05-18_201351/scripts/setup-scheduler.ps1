$action = New-ScheduledTaskAction -Execute "C:\Users\tvonh\Desktop\getforgenta\scripts\reddit-scout.bat"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 9pm
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "ForgentaRedditScout" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
Write-Host "Done. Task registered." -ForegroundColor Green
Start-Sleep -Seconds 3

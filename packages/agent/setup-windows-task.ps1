# CCremote Agent - Windows Task Setup Script
# Run this script as Administrator

$TaskName = "CCremote-Agent"
$TaskNameMonitor = "CCremote-Agent-Monitor"
$VbsPath = "D:\claudeworkspace\CCremote\packages\agent\start-agent-hidden.vbs"

# Delete existing tasks if they exist
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskNameMonitor -Confirm:$false -ErrorAction SilentlyContinue

# Create task for auto-start at login (run hidden in background)
$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogon
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable -DontStopOnIdleEnd
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "CCremote Agent - Auto start at login"

# Create task for monitoring (check every 3 minutes, run hidden)
$MonitorVbsPath = "D:\claudeworkspace\CCremote\packages\agent\monitor-agent-hidden.vbs"
$ActionMonitor = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$MonitorVbsPath`""
$TriggerMonitor = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 3)
$SettingsMonitor = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskNameMonitor -Action $ActionMonitor -Trigger $TriggerMonitor -Settings $SettingsMonitor -Principal $Principal -Description "CCremote Agent Monitor - Check and restart if needed"

Write-Host "Tasks created successfully!"
Write-Host "1. CCremote-Agent - Starts at login"
Write-Host "2. CCremote-Agent-Monitor - Checks every 3 minutes (hidden)"

# Start the agent now
Write-Host "Starting agent..."
Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`""
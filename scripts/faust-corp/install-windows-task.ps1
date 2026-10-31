# Windows: start the Faust Corp node at logon via Task Scheduler.
# Run once in PowerShell (adjust the paths and the host name first):
#   powershell -ExecutionPolicy Bypass -File install-windows-task.ps1
$repo = "$env:USERPROFILE\Faust-Corp"
$cliArgs = "`"$repo\dist\cli.js`" --port 3100 --allowed-host CHANGE-ME.tailnet.ts.net"
$action = New-ScheduledTaskAction -Execute "node.exe" -Argument $cliArgs -WorkingDirectory $env:USERPROFILE
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Faust Corp" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Output "Registered. Start now with: Start-ScheduledTask -TaskName 'Faust Corp'"

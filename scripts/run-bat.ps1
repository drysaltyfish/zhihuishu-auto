Start-Process -FilePath "cmd.exe" -ArgumentList '/c','start.bat' -WorkingDirectory (Get-Location).Path -WindowStyle Normal
Write-Output "launched detached"

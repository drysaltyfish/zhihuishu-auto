param([string]$Source, [string]$Target)
$c = [IO.File]::ReadAllText((Resolve-Path $Source), [Text.Encoding]::UTF8)
[IO.File]::WriteAllText((Join-Path (Get-Location) $Target), $c, [Text.Encoding]::GetEncoding(936))
Write-Output "converted $Source -> $Target (gbk)"

param([int]$Port = 4173)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be 1..65535' }
& node (Join-Path $PSScriptRoot 'web\server.mjs') $Port
if ($LASTEXITCODE -ne 0) { throw 'Local preview stopped with an error' }

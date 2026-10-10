$ErrorActionPreference = 'Stop'
$runArguments = @($args)
$runKeep = $false
if ($runArguments.Count -and $runArguments[0] -eq '-KeepArtifacts') {
    $runKeep = $true
    $runArguments = @($runArguments | Select-Object -Skip 1)
}
if (-not $runArguments.Count) { throw 'Usage: run-clean.ps1 [-KeepArtifacts] COMMAND [ARGUMENTS...]' }
$runCommand = $runArguments[0]
$runArguments = @($runArguments | Select-Object -Skip 1)
$runProject = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'temporary-artifacts.ps1')
$runScope = New-RogueArtifactScope -ProjectPath $runProject -KeepArtifacts:$runKeep
try {
& (Join-Path $PSScriptRoot 'artifact-registry.ps1') -Mode Register -ProjectPath $runProject -ScopePath $runScope.Path -OwnerPid $PID -Keep $(if ($runScope.Keep) {'1'} else {'0'})
    Push-Location -LiteralPath $runProject
    try {
        $global:LASTEXITCODE = 0
        & $runCommand @runArguments
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally { Pop-Location }
} finally { Close-RogueArtifactScope $runScope }

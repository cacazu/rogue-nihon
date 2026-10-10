param(
    [Parameter(Mandatory)][ValidateSet('Register','Recover')][string]$Mode,
    [Parameter(Mandatory)][string]$ProjectPath,
    [string]$ScopePath,
    [uint32]$OwnerPid,
    [ValidateSet('0','1')][string]$Keep = '0'
)
$ErrorActionPreference = 'Stop'
$registryProject = (Resolve-Path -LiteralPath $ProjectPath).ProviderPath.TrimEnd('\')
$registryBase = Join-Path $registryProject '.local\tasks'

function Test-RogueRegistryPath([string]$Target, [switch]$Tree) {
    if ((Split-Path -Parent $Target) -ne $registryBase -or
        -not $Target.StartsWith($registryProject + '\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $registryAncestor = $Target
    while ($registryAncestor -ne $registryProject) {
        if ((Get-Item -LiteralPath $registryAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        $registryAncestor = Split-Path -Parent $registryAncestor
    }
    if ($Tree -and @(Get-ChildItem -LiteralPath $Target -Force -Recurse -Attributes ReparsePoint).Count) { return $false }
    return (Resolve-Path -LiteralPath $Target).ProviderPath -eq $Target
}

function Initialize-RogueProcessQueries {
    if (-not ('RogueArtifactProcesses' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'artifact-processes.cs') }
}

function Invoke-RogueRecovery {
    if (-not (Test-Path -LiteralPath $registryBase)) { return }
    $registryCandidates = @()
    foreach ($registryEntry in @(Get-ChildItem -LiteralPath $registryBase -Directory -Force)) {
        try {
            if ($registryEntry.Name -notmatch '^(node|python|powershell)-[a-zA-Z0-9_-]+$' -or
                -not (Test-RogueRegistryPath $registryEntry.FullName)) { continue }
            $registryMarker = Join-Path $registryEntry.FullName '.rogue-owner.json'
            if (-not (Test-Path -LiteralPath $registryMarker -PathType Leaf) -or
                ((Get-Item -LiteralPath $registryMarker -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
                (Get-Item -LiteralPath $registryMarker -Force).Length -gt 65536) { continue }
            $registryRecord = Get-Content -LiteralPath $registryMarker -Raw | ConvertFrom-Json
            if (($registryRecord.version -isnot [int] -and $registryRecord.version -isnot [long]) -or
                $registryRecord.version -ne 1 -or $registryRecord.project -isnot [string] -or $registryRecord.project -ne $registryProject -or
                $registryRecord.directory -isnot [string] -or $registryRecord.directory -ne $registryEntry.Name -or
                $registryRecord.keep -isnot [bool] -or $registryRecord.keep -or
                ($registryRecord.owner_pid -isnot [long] -and $registryRecord.owner_pid -isnot [int]) -or $registryRecord.owner_pid -le 0 -or
                $registryRecord.owner_pid -gt [uint32]::MaxValue -or
                $registryRecord.owner_start -isnot [string] -or $registryRecord.owner_start -notmatch '^\d+$' -or
                $registryRecord.token -isnot [string] -or $registryRecord.token -notmatch '^[a-f0-9]{32}$') { continue }
            $registryCandidates += [pscustomobject]@{Path=$registryEntry.FullName;Record=$registryRecord}
        } catch { continue } # Unknown, incomplete and legacy directories are preserved.
    }
    if (-not $registryCandidates.Count) { return }
    try {
        Initialize-RogueProcessQueries
        $registryCandidates = @($registryCandidates | Where-Object {
            $registryOwner = [RogueArtifactProcesses]::Query([uint32]$_.Record.owner_pid)
            $registryOwner.Status -ne 'unknown' -and
                ($registryOwner.Status -ne 'alive' -or $registryOwner.Start -ne $_.Record.owner_start)
        })
        if (-not $registryCandidates.Count) { return }
        $registryProcesses = [RogueArtifactProcesses]::Snapshot()
    } catch { Write-Warning ('Temporary artifact recovery deferred: ' + $_.Exception.Message); return }
    foreach ($registryCandidate in $registryCandidates) {
        try {
            $registryRecord = $registryCandidate.Record
            $registryOwner = [RogueArtifactProcesses]::Query([uint32]$registryRecord.owner_pid)
            if ($registryOwner.Status -eq 'unknown' -or
                ($registryOwner.Status -eq 'alive' -and $registryOwner.Start -eq $registryRecord.owner_start)) { continue }
            # A surviving compiler/browser child may still use a dead owner's scope.
            $registryDescendants = [Collections.Generic.HashSet[uint32]]::new()
            $null = $registryDescendants.Add([uint32]$registryRecord.owner_pid)
            do {
                $registryChanged = $false
                foreach ($registryProcess in $registryProcesses) {
                    if ($registryDescendants.Contains($registryProcess.Parent) -and
                        $registryDescendants.Add($registryProcess.Pid)) { $registryChanged = $true }
                }
            } while ($registryChanged)
            $registryBusy = @($registryProcesses | Where-Object {
                ($_.Pid -ne $registryRecord.owner_pid -and $registryDescendants.Contains($_.Pid) -and $_.Status -ne 'gone') -or
                ($_.Command -and $_.Command.Replace('/','\').IndexOf($registryCandidate.Path,[StringComparison]::OrdinalIgnoreCase) -ge 0)
            }).Count -gt 0
            if ($registryBusy -or -not (Test-RogueRegistryPath $registryCandidate.Path -Tree)) { continue }
            # Re-read immutable ownership immediately before deleting; never sweep build/.
            $registryLatest = Get-Content -LiteralPath (Join-Path $registryCandidate.Path '.rogue-owner.json') -Raw | ConvertFrom-Json
            if ($registryLatest.token -ne $registryRecord.token -or $registryLatest.keep -ne $false -or
                $registryLatest.owner_pid -ne $registryRecord.owner_pid -or $registryLatest.owner_start -ne $registryRecord.owner_start -or
                $registryLatest.version -ne $registryRecord.version -or $registryLatest.project -ne $registryRecord.project -or
                $registryLatest.directory -ne $registryRecord.directory) { continue }
            foreach ($registryEntry in @(Get-ChildItem -LiteralPath $registryCandidate.Path -Force)) {
                if ($registryEntry.Name -ne '.rogue-owner.json') { Remove-Item -LiteralPath $registryEntry.FullName -Recurse -Force }
            }
            $registryMarker = Join-Path $registryCandidate.Path '.rogue-owner.json'
            Remove-Item -LiteralPath $registryMarker -Force
            try { [IO.Directory]::Delete($registryCandidate.Path) }
            catch { [IO.File]::WriteAllText($registryMarker,($registryLatest | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false)); throw }
        } catch {
            if (Test-Path -LiteralPath $registryCandidate.Path) { Write-Warning ('Temporary artifact recovery deferred: ' + $_.Exception.Message) }
        }
    }
}

try { Invoke-RogueRecovery }
catch { Write-Warning ('Temporary artifact recovery deferred: ' + $_.Exception.Message) }
if ($Mode -eq 'Register') {
    $registryScope = (Resolve-Path -LiteralPath $ScopePath).ProviderPath
    if (-not (Test-RogueRegistryPath $registryScope) -or
        (Split-Path -Leaf $registryScope) -notmatch '^(node|python|powershell)-[a-zA-Z0-9_-]+$') { throw 'Unsafe artifact registration target' }
    Initialize-RogueProcessQueries
    $registryOwner = [RogueArtifactProcesses]::Query($OwnerPid)
    if ($registryOwner.Status -ne 'alive') { throw 'Cannot identify artifact owner' }
    $registryRecord = [ordered]@{
        version=1;project=$registryProject;directory=(Split-Path -Leaf $registryScope)
        owner_pid=[long]$OwnerPid;owner_start=$registryOwner.Start;keep=($Keep -eq '1')
        token=[guid]::NewGuid().ToString('N')
    }
    $registryJson = ($registryRecord | ConvertTo-Json -Compress) + "`n"
    $registryStream = [IO.FileStream]::new((Join-Path $registryScope '.rogue-owner.json'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    try {
        $registryBytes = [Text.UTF8Encoding]::new($false).GetBytes($registryJson)
        $registryStream.Write($registryBytes,0,$registryBytes.Length)
    } finally { $registryStream.Dispose() }
}

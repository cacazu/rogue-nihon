function New-RogueArtifactScope {
    param([Parameter(Mandatory)][string]$ProjectPath, [switch]$KeepArtifacts)
    $scopeProject = (Resolve-Path -LiteralPath $ProjectPath).ProviderPath.TrimEnd('\')
    $scopeBase = Join-Path $scopeProject '.local\tasks'
    $scopeAncestor = $scopeBase
    while (-not (Test-Path -LiteralPath $scopeAncestor)) { $scopeAncestor = Split-Path -Parent $scopeAncestor }
    while ($scopeAncestor -ne $scopeProject) {
        if ((Get-Item -LiteralPath $scopeAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Artifact parent must not be a junction or symlink' }
        $scopeAncestor = Split-Path -Parent $scopeAncestor
    }
    New-Item -ItemType Directory -Path $scopeBase -Force | Out-Null
    if ((Get-Item -LiteralPath $scopeBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Artifact base must not be a junction or symlink' }
    if ($env:ROGUE_ARTIFACT_SCOPE) {
        $scopeInherited = (Resolve-Path -LiteralPath $env:ROGUE_ARTIFACT_SCOPE).ProviderPath
        if ((Split-Path -Parent $scopeInherited) -ne $scopeBase -or -not (Test-Path -LiteralPath (Join-Path $scopeInherited 'owner.txt'))) { throw 'Invalid inherited artifact scope' }
        return [pscustomobject]@{Path=$scopeInherited;Base=$scopeBase;Project=$scopeProject;Owned=$false;Keep=($env:ROGUE_KEEP_ARTIFACTS -eq '1');Previous=@{}}
    }
    $scopePath = Join-Path $scopeBase ('powershell-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scopePath | Out-Null
    $scopeToken = [guid]::NewGuid().ToString('N')
    Set-Content -LiteralPath (Join-Path $scopePath 'owner.txt') -Value $scopeToken -NoNewline
    $scopeKeep = $KeepArtifacts -or $env:ROGUE_KEEP_ARTIFACTS -eq '1'
    $scopeBuild = if ($scopeKeep) { Join-Path $scopeProject 'build' } else { Join-Path $scopePath 'build' }
    $scopeSettings = @{
        ROGUE_ARTIFACT_SCOPE=$scopePath; ROGUE_ARTIFACT_BUILD=$scopeBuild
        CARGO_TARGET_DIR=(Join-Path $scopePath 'cargo-target'); EM_CACHE=(Join-Path $scopePath 'em-cache')
        TEMP=(Join-Path $scopePath 'temp'); TMP=(Join-Path $scopePath 'temp'); TMPDIR=(Join-Path $scopePath 'temp')
        PYTHONDONTWRITEBYTECODE='1'; ROGUE_KEEP_ARTIFACTS=$(if ($scopeKeep) {'1'} else {'0'})
    }
    foreach ($scopeDirectory in @($scopeBuild,$scopeSettings.TEMP)) { New-Item -ItemType Directory -Path $scopeDirectory -Force | Out-Null }
    $scopePrevious = @{}
    foreach ($scopeName in $scopeSettings.Keys) {
        $scopePrevious[$scopeName] = [Environment]::GetEnvironmentVariable($scopeName,'Process')
        [Environment]::SetEnvironmentVariable($scopeName,$scopeSettings[$scopeName],'Process')
    }
    return [pscustomobject]@{Path=$scopePath;Base=$scopeBase;Project=$scopeProject;Owned=$true;Keep=$scopeKeep;Token=$scopeToken;Previous=$scopePrevious}
}

function Close-RogueArtifactScope {
    param([Parameter(Mandatory)]$Scope)
    try {
        if (-not $Scope.Owned) { return }
        if ($Scope.Keep) { Write-Host ('Artifacts retained: ' + $Scope.Path); return }
        if (-not (Test-Path -LiteralPath $Scope.Path)) { return }
        $scopeAncestor = $Scope.Base
        while ($scopeAncestor -ne $Scope.Project) {
            if ((Get-Item -LiteralPath $scopeAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Artifact cleanup parent must not be a junction or symlink' }
            $scopeAncestor = Split-Path -Parent $scopeAncestor
        }
        $scopeResolved = (Resolve-Path -LiteralPath $Scope.Path).ProviderPath
        if ($scopeResolved -ne $Scope.Path -or (Split-Path -Parent $scopeResolved) -ne $Scope.Base -or
            -not $scopeResolved.StartsWith($Scope.Project + '\',[StringComparison]::OrdinalIgnoreCase) -or
            ((Get-Item -LiteralPath $scopeResolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            (Get-Content -LiteralPath (Join-Path $scopeResolved 'owner.txt') -Raw) -ne $Scope.Token) { throw 'Unsafe artifact cleanup target' }
        if (@(Get-ChildItem -LiteralPath $scopeResolved -Force -Recurse -Attributes ReparsePoint).Count) { throw 'Artifact cleanup must not traverse a junction or symlink' }
        # Only the uniquely owned workspace is removed. Never sweep build/ or rust/target/.
        $scopeMarker = Join-Path $scopeResolved '.rogue-owner.json'
        $scopeOwnership = if (Test-Path -LiteralPath $scopeMarker) { [IO.File]::ReadAllText($scopeMarker) } else { $null }
        foreach ($scopeEntry in @(Get-ChildItem -LiteralPath $scopeResolved -Force)) {
            if ($scopeEntry.Name -ne '.rogue-owner.json') { Remove-Item -LiteralPath $scopeEntry.FullName -Recurse -Force }
        }
        Remove-Item -LiteralPath $scopeMarker -Force -ErrorAction SilentlyContinue
        try { [IO.Directory]::Delete($scopeResolved) }
        catch { if ($null -ne $scopeOwnership) { [IO.File]::WriteAllText($scopeMarker,$scopeOwnership,[Text.UTF8Encoding]::new($false)) }; throw }
    } finally {
        foreach ($scopeName in $Scope.Previous.Keys) {
            if ($null -eq $Scope.Previous[$scopeName]) { Remove-Item -LiteralPath ('Env:' + $scopeName) -ErrorAction SilentlyContinue }
            else { [Environment]::SetEnvironmentVariable($scopeName,$Scope.Previous[$scopeName],'Process') }
        }
    }
}

function Set-RogueSdkEnvironment {
    param([Parameter(Mandatory)]$Scope, [Parameter(Mandatory)][string]$SdkRoot)
    $scopeSdk = [IO.Path]::GetFullPath($SdkRoot)
    $scopeSdkSettings = @{EM_CONFIG=(Join-Path $scopeSdk '.emscripten');EMSDK_PYTHON=(Join-Path $scopeSdk 'python\3.13.3_64bit\python.exe')}
    foreach ($scopeName in $scopeSdkSettings.Keys) {
        if (-not $Scope.Previous.ContainsKey($scopeName)) { $Scope.Previous[$scopeName] = [Environment]::GetEnvironmentVariable($scopeName,'Process') }
        [Environment]::SetEnvironmentVariable($scopeName,$scopeSdkSettings[$scopeName],'Process')
    }
}

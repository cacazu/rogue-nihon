$ErrorActionPreference = 'Stop'
$rogueRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rogueOutputDirectory = Join-Path $rogueRoot 'distribution'
$rogueOutput = Join-Path $rogueOutputDirectory 'rogue-5.4.4-licenses.zip'
$rogueFiles = @('docs/LICENSES-ja.md', 'logic/LICENSE.TXT', 'THIRD-PARTY-NOTICES.md',
    'licenses/THIRD-PARTY.txt', 'licenses/manifest.json')

$rogueManifest = Get-Content -LiteralPath (Join-Path $rogueRoot 'licenses/manifest.json') -Raw | ConvertFrom-Json
if ($rogueManifest.format -ne 1) { throw 'Unsupported license inventory; regenerate with collect-licenses.py.' }
$rogueLockHash = (Get-FileHash -LiteralPath (Join-Path $rogueRoot 'rust/Cargo.lock') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($rogueLockHash -ne $rogueManifest.scope.cargo_lock_sha256) { throw 'Cargo.lock changed; regenerate the license inventory.' }
$rogueNoticeBytes = [IO.File]::ReadAllBytes((Join-Path $rogueRoot 'licenses/THIRD-PARTY.txt'))
$rogueNoticeIds = @{}
foreach ($rogueNotice in $rogueManifest.notices) {
    if ($rogueNotice.byte_offset -lt 0 -or $rogueNotice.bytes -le 0 -or
        $rogueNotice.byte_offset + $rogueNotice.bytes -gt $rogueNoticeBytes.Length) { throw 'Invalid notice byte range.' }
    $rogueBody = [byte[]]::new($rogueNotice.bytes)
    [Array]::Copy($rogueNoticeBytes, $rogueNotice.byte_offset, $rogueBody, 0, $rogueNotice.bytes)
    $rogueHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($rogueBody)).ToLowerInvariant()
    if ($rogueHash -ne $rogueNotice.id) { throw ('Notice text changed: ' + $rogueNotice.id) }
    $rogueNoticeIds[$rogueNotice.id] = $true
}
foreach ($rogueComponent in $rogueManifest.components) {
    if (-not $rogueComponent.notices.Count) { throw ('Missing notices: ' + $rogueComponent.component) }
    foreach ($rogueNotice in $rogueComponent.notices) {
        if (-not $rogueNoticeIds.ContainsKey($rogueNotice.id)) { throw ('Unknown notice: ' + $rogueNotice.id) }
    }
}

# Package only the current guide, original license and consolidated notices.
$rogueMemory = [IO.MemoryStream]::new()
$rogueArchive = [IO.Compression.ZipArchive]::new($rogueMemory, [IO.Compression.ZipArchiveMode]::Create, $true)
try {
    foreach ($rogueFile in @($rogueFiles | Sort-Object)) {
        $rogueBytes = [IO.File]::ReadAllBytes((Join-Path $rogueRoot $rogueFile))
        $rogueEntry = $rogueArchive.CreateEntry($rogueFile, [IO.Compression.CompressionLevel]::Optimal)
        $rogueEntry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
        $rogueStream = $rogueEntry.Open()
        try { $rogueStream.Write($rogueBytes, 0, $rogueBytes.Length) } finally { $rogueStream.Dispose() }
    }
} finally { $rogueArchive.Dispose() }
try {
    [IO.Directory]::CreateDirectory($rogueOutputDirectory) | Out-Null
    [IO.File]::WriteAllBytes($rogueOutput, $rogueMemory.ToArray())
} finally { $rogueMemory.Dispose() }
Write-Output "License bundle: $rogueOutput"

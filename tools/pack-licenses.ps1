$ErrorActionPreference = 'Stop'
$rogueRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rogueOutputDirectory = Join-Path $rogueRoot 'distribution'
$rogueOutput = Join-Path $rogueOutputDirectory 'rogue-5.4.4-licenses.zip'
$rogueFiles = @('docs/LICENSES-ja.md', 'logic/LICENSE.TXT', 'THIRD-PARTY-NOTICES.md')
$rogueFiles += @(Get-ChildItem (Join-Path $rogueRoot 'licenses') -Recurse -File |
    Where-Object { $_.Name -ne 'manifest.json' } |
    ForEach-Object { [IO.Path]::GetRelativePath($rogueRoot, $_.FullName).Replace('\', '/') })

# Keep license text byte-for-byte; acquisition paths are not part of the public inventory.
$rogueManifest = @(Get-Content (Join-Path $rogueRoot 'licenses/manifest.json') -Raw | ConvertFrom-Json |
    ForEach-Object {
        $roguePublicEntry = [ordered]@{}
        foreach ($rogueProperty in $_.PSObject.Properties) {
            if ($rogueProperty.Name -ne 'source') { $roguePublicEntry[$rogueProperty.Name] = $rogueProperty.Value }
        }
        $roguePublicEntry
    })
$roguePublicManifest = [Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $rogueManifest -Depth 8) + "`n")
$rogueMemory = [IO.MemoryStream]::new()
$rogueArchive = [IO.Compression.ZipArchive]::new($rogueMemory, [IO.Compression.ZipArchiveMode]::Create, $true)
try {
    foreach ($rogueFile in @($rogueFiles + 'licenses/manifest.json' | Sort-Object)) {
        $rogueBytes = if ($rogueFile -eq 'licenses/manifest.json') { $roguePublicManifest }
            else { [IO.File]::ReadAllBytes((Join-Path $rogueRoot $rogueFile)) }
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

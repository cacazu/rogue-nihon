param(
    [string]$Destination = 'C:\Users\kit\gameme\jnethack\jrouge\rogue-four-layer'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sourceDirectory = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$destinationDirectory = [System.IO.Path]::GetFullPath($Destination)
$projectDirectory = [System.IO.Path]::GetFullPath((Split-Path -Parent $destinationDirectory))
if ($destinationDirectory -ne 'C:\Users\kit\gameme\jnethack\jrouge\rogue-four-layer') { throw 'Unexpected delivery destination' }
if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) { throw 'Previous delivery is required' }
if ((Get-Item -LiteralPath $destinationDirectory).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Destination is a reparse point' }

function Get-Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-ContainedPath([string]$Root, [string]$Relative) {
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $resolved.StartsWith($Root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw ('Path leaves delivery root: ' + $Relative) }
    $resolved
}
function Get-ProtectedFiles {
    $protectedPaths = @((Join-Path $projectDirectory 'README.md'))
    foreach ($directory in @('brogue','investigation-20261002-original-rogue','investigation-20261002-rouge')) {
        $path = Join-Path $projectDirectory $directory
        if (Test-Path -LiteralPath $path -PathType Container) {
            $protectedPaths += @(Get-ChildItem -LiteralPath $path -Recurse -File -Force | ForEach-Object { $_.FullName })
        }
    }
    @(foreach ($path in ($protectedPaths | Sort-Object)) {
        [ordered]@{ path=[System.IO.Path]::GetRelativePath($projectDirectory,$path);bytes=(Get-Item -LiteralPath $path).Length;sha256=(Get-Sha $path) }
    })
}
$verificationPath = Join-Path $sourceDirectory 'verification.json'
$inventoryPath = Join-Path $sourceDirectory 'artifacts-manifest.json'
$verification = Get-Content -LiteralPath $verificationPath -Raw -Encoding utf8 | ConvertFrom-Json
$inventory = Get-Content -LiteralPath $inventoryPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($verification.status -ne 'passed' -or $verification.delivery_target -ne $destinationDirectory) { throw 'Final verification has not passed for this target' }
if ((Get-Sha $inventoryPath) -ne $verification.inventory.sha256) { throw 'Final inventory digest mismatch' }
$priorInventoryPath = Join-Path $destinationDirectory 'artifacts-manifest.json'
$priorInventory = Get-Content -LiteralPath $priorInventoryPath -Raw -Encoding utf8 | ConvertFrom-Json
$priorReceipt = Get-Content -LiteralPath (Join-Path $destinationDirectory 'delivery.json') -Raw -Encoding utf8 | ConvertFrom-Json
if ((Get-Sha $priorInventoryPath) -ne $priorReceipt.inventory_sha256 -or (Get-Sha (Join-Path $destinationDirectory 'verification.json')) -ne $priorReceipt.verification_sha256) { throw 'Previous delivery records were edited; preserve and review before updating' }
foreach ($entry in $priorInventory.files) {
    $path = Get-ContainedPath $destinationDirectory $entry.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Sha $path) -ne $entry.sha256) { throw ('Previous delivery has user changes: ' + $entry.path) }
}
foreach ($entry in $inventory.files) {
    $path = Get-ContainedPath $sourceDirectory $entry.path
    if ((Get-Item -LiteralPath $path).Length -ne $entry.bytes -or (Get-Sha $path) -ne $entry.sha256) { throw ('Source differs from final inventory: ' + $entry.path) }
}
$protectedBefore = Get-ProtectedFiles
$backupName = 'rogue-four-layer-backup-english-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backupDirectory = Get-ContainedPath $projectDirectory $backupName
if (Test-Path -LiteralPath $backupDirectory) { throw 'Backup already exists' }
Copy-Item -LiteralPath $destinationDirectory -Destination $backupDirectory -Recurse
foreach ($entry in $priorInventory.files) {
    if ((Get-Sha (Get-ContainedPath $backupDirectory $entry.path)) -ne $entry.sha256) { throw ('Previous version backup mismatch: ' + $entry.path) }
}
$copiedBytes = [long]0
foreach ($entry in $inventory.files) {
    $from = Get-ContainedPath $sourceDirectory $entry.path
    $to = Get-ContainedPath $destinationDirectory $entry.path
    $parent = Split-Path -Parent $to
    [void](New-Item -ItemType Directory -Path $parent -Force)
    Copy-Item -LiteralPath $from -Destination $to -Force
    if ((Get-Sha $to) -ne $entry.sha256) { throw ('Delivery hash mismatch: ' + $entry.path) }
    $copiedBytes += [long]$entry.bytes
}
foreach ($name in @('verification.json','artifacts-manifest.json')) {
    $from = Join-Path $sourceDirectory $name
    $to = Join-Path $destinationDirectory $name
    Copy-Item -LiteralPath $from -Destination $to -Force
    if ((Get-Sha $to) -ne (Get-Sha $from)) { throw ('Delivery record mismatch: ' + $name) }
    $copiedBytes += (Get-Item -LiteralPath $from).Length
}
$protectedAfter = Get-ProtectedFiles
if (($protectedBefore | ConvertTo-Json -Depth 6 -Compress) -ne ($protectedAfter | ConvertTo-Json -Depth 6 -Compress)) { throw 'A protected Brogue or investigation file changed during delivery' }
$originalDirectory = Join-Path $projectDirectory 'investigation-20261002-original-rogue'
$originalFiles = Get-Content -LiteralPath (Join-Path $originalDirectory 'source-files.json') -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($entry in $originalFiles) {
    $path = Get-ContainedPath (Join-Path $originalDirectory 'sources\rogue5.4.4') $entry.path
    if ((Get-Sha $path) -ne $entry.sha256) { throw ('Original source changed: ' + $entry.path) }
}
$archiveHash = Get-Sha (Join-Path $originalDirectory 'rogue5.4.4-src.tar.gz')
if ($archiveHash -ne '7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1') { throw 'Original archive changed' }
$receipt = [ordered]@{
    schema=2;delivered_at_utc=(Get-Date).ToUniversalTime().ToString('o');status='passed';language='ja';
    source_directory=$sourceDirectory;destination_directory=$destinationDirectory;previous_version_backup=$backupDirectory;
    previous_inventory_files_checked=$priorInventory.files.Count;user_edits_detected=0;
    copied_files=($inventory.files.Count + 2);copied_bytes=$copiedBytes;all_copied_file_hashes_match=$true;
    inventory_sha256=(Get-Sha $inventoryPath);verification_sha256=(Get-Sha $verificationPath);
    protected_brogue_and_investigation_files_checked=$protectedBefore.Count;protected_files_unchanged=$true;
    original_source_files_rechecked=$originalFiles.Count;original_archive_sha256=$archiveHash;
    game_wasm_sha256=(Get-Sha (Join-Path $destinationDirectory 'build\game.wasm'));
    file_deletions=0;publishing_performed=$false
}
$receiptJson = $receipt | ConvertTo-Json -Depth 8
$receiptJson | Set-Content -LiteralPath (Join-Path $sourceDirectory 'delivery.json') -Encoding utf8
$receiptJson | Set-Content -LiteralPath (Join-Path $destinationDirectory 'delivery.json') -Encoding utf8
Write-Output $receiptJson

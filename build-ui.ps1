param([string]$OutputDirectory, [switch]$KeepArtifacts)
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
. (Join-Path $project 'tools\temporary-artifacts.ps1')
$uiArtifactScope = New-RogueArtifactScope -ProjectPath $project -KeepArtifacts:$KeepArtifacts
try {
$uiOutputPath = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { $env:ROGUE_ARTIFACT_BUILD }
& cargo build --offline --locked --manifest-path (Join-Path $project 'rust\Cargo.toml') --release -p rogue-browser-display --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'Rust browser UI build failed' }
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-unknown\release\rogue_browser_display.wasm') -Destination (Join-Path $uiOutputPath 'browser-ui.wasm')
if (-not $OutputDirectory -and $uiOutputPath -ne (Join-Path $project 'build')) {
    Copy-Item -LiteralPath (Join-Path $uiOutputPath 'browser-ui.wasm') -Destination (Join-Path $project 'build\browser-ui.wasm') -Force
}
if (-not $OutputDirectory) {
    $uiManifestPath = Join-Path $project 'build\build-manifest.json'
    if (Test-Path -LiteralPath $uiManifestPath) {
        $uiManifest = Get-Content -LiteralPath $uiManifestPath -Raw | ConvertFrom-Json
        $uiPublishedFile = Join-Path $project 'build\browser-ui.wasm'
        $uiRecord = [ordered]@{file='browser-ui.wasm';bytes=(Get-Item -LiteralPath $uiPublishedFile).Length;sha256=(Get-FileHash -LiteralPath $uiPublishedFile -Algorithm SHA256).Hash.ToLowerInvariant()}
        $uiManifest.outputs = @($uiManifest.outputs | Where-Object { $_.file -ne 'browser-ui.wasm' }) + @($uiRecord)
        # Preserve the original game build date; only this independent UI was rebuilt.
        $uiManifest | Add-Member -NotePropertyName browser_ui -NotePropertyValue ([ordered]@{built_at_utc=(Get-Date).ToUniversalTime().ToString('o');crate='rogue-browser-display';target='wasm32-unknown-unknown'}) -Force
        [IO.File]::WriteAllText($uiManifestPath,($uiManifest | ConvertTo-Json -Depth 8).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
    }
}
Write-Output 'Built Rust browser UI: build/browser-ui.wasm'
} finally { Close-RogueArtifactScope $uiArtifactScope }

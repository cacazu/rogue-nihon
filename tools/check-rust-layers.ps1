param(
    [string]$SdkRoot = 'C:\Users\kit\emsdk',
    [ValidateSet('layer-check','entity-check','engine-check')][string]$Binary = 'layer-check',
    [switch]$KeepArtifacts
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'temporary-artifacts.ps1')
$checkScope = New-RogueArtifactScope -ProjectPath $projectPath -KeepArtifacts:$KeepArtifacts
try {
Set-RogueSdkEnvironment -Scope $checkScope -SdkRoot $SdkRoot
$linkerPath = Join-Path $SdkRoot 'upstream\emscripten\emcc.exe'
$configPath = Join-Path $SdkRoot '.emscripten'
$cachePath = $env:EM_CACHE
$manifestPath = Join-Path $projectPath 'rust\Cargo.toml'
$executablePath = Join-Path $env:CARGO_TARGET_DIR ('wasm32-unknown-emscripten\release\' + $Binary + '.js')
foreach ($toolPath in @($linkerPath, $configPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw ('Missing tool or manifest: ' + $toolPath) }
}
$previousConfig = $env:EM_CONFIG
$previousCache = $env:EM_CACHE
try {
    $env:EM_CONFIG = $configPath
    $env:EM_CACHE = $cachePath
    & cargo rustc --offline --locked --manifest-path $manifestPath --bin $Binary --release --target wasm32-unknown-emscripten --features test-hooks -- -C ('linker=' + $linkerPath) -C panic=abort -C link-arg=-sENVIRONMENT=node -C link-arg=-sEXIT_RUNTIME=1 -C link-arg=-sALLOW_MEMORY_GROWTH=1
    if ($LASTEXITCODE -ne 0) { throw ('Pure Rust build failed: ' + $Binary) }
    & node $executablePath
    if ($LASTEXITCODE -ne 0) { throw ('Pure Rust execution failed: ' + $Binary) }
} finally {
    $env:EM_CONFIG = $previousConfig
    $env:EM_CACHE = $previousCache
}
} finally { Close-RogueArtifactScope $checkScope }

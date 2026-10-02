param(
    [string]$SdkRoot = 'C:\Users\kit\emsdk',
    [ValidateSet('layer-check','entity-check')][string]$Binary = 'layer-check'
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$taskPath = Split-Path -Parent $projectPath
$linkerPath = Join-Path $SdkRoot 'upstream\emscripten\emcc.exe'
$configPath = Join-Path $SdkRoot '.emscripten'
$cachePath = Join-Path $taskPath 'rogue-toolchain\em-cache'
$manifestPath = Join-Path $projectPath 'rust\Cargo.toml'
$executablePath = Join-Path $projectPath ('rust\target\wasm32-unknown-emscripten\release\' + $Binary + '.js')
foreach ($toolPath in @($linkerPath, $configPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw ('Missing tool or manifest: ' + $toolPath) }
}
$previousConfig = $env:EM_CONFIG
$previousCache = $env:EM_CACHE
try {
    $env:EM_CONFIG = $configPath
    $env:EM_CACHE = $cachePath
    & cargo rustc --offline --locked --manifest-path $manifestPath --bin $Binary --release --target wasm32-unknown-emscripten -- -C ('linker=' + $linkerPath) -C panic=abort -C link-arg=-sENVIRONMENT=node -C link-arg=-sEXIT_RUNTIME=1 -C link-arg=-sALLOW_MEMORY_GROWTH=1
    if ($LASTEXITCODE -ne 0) { throw 'Pure Rust layer-check build failed' }
    & node $executablePath
    if ($LASTEXITCODE -ne 0) { throw 'Pure Rust layer-check execution failed' }
} finally {
    $env:EM_CONFIG = $previousConfig
    $env:EM_CACHE = $previousCache
}

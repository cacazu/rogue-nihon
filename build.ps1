param(
    [string]$SdkRoot = 'C:\Users\kit\emsdk',
    [switch]$SkipRust,
    [string]$OutputName = 'game',
    [string]$LogicDirectory,
    [switch]$SkipCatalogGeneration,
    [switch]$TestFixtures
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$project = $PSScriptRoot
$pythonPath = Join-Path $SdkRoot 'python\3.13.3_64bit\python.exe'
$emccPath = Join-Path $SdkRoot 'upstream\emscripten\emcc.py'
$configPath = Join-Path $SdkRoot '.emscripten'
$cachePath = Join-Path $project 'build\em-cache'
$buildPath = Join-Path $project 'build'
$logicPath = if ($LogicDirectory) { [System.IO.Path]::GetFullPath($LogicDirectory) } else { Join-Path $project 'logic' }
$rustManifest = Join-Path $project 'rust\Cargo.toml'
$rustLibrary = Join-Path $project 'rust\target\wasm32-unknown-emscripten\release\librogue_layers.a'
foreach ($toolPath in @($pythonPath,$emccPath,$configPath)) {
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw ('Missing tool: ' + $toolPath) }
}
if ($OutputName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid output name' }
& (Join-Path $project 'generate-abi.ps1')
if (-not $SkipCatalogGeneration) {
    & $pythonPath (Join-Path $project 'tools\generate_catalog.py')
    if ($LASTEXITCODE -ne 0) { throw 'Catalog generation failed' }
}
if (-not $SkipRust) {
    & cargo build --offline --manifest-path $rustManifest --release --lib --target wasm32-unknown-emscripten
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
}
if (-not (Test-Path -LiteralPath $rustLibrary)) { throw 'Rust library missing' }
$sources = @('vers','extern','armor','chase','command','daemon','daemons','fight','init','io','list','mach_dep','main','mdport','misc','monsters','move','new_level','options','pack','passages','potions','rings','rip','rooms','save','scrolls','state','sticks','things','weapons','wizard','xcrypt','core','knowledge','message','save_adapter','semantic')
$compilerArguments = [System.Collections.Generic.List[string]]::new()
foreach ($source in $sources) {
    $path = Join-Path $logicPath ($source + '.c')
    if (-not (Test-Path -LiteralPath $path)) { throw ('Missing C source: ' + $path) }
    $compilerArguments.Add($path)
}
$compilerArguments.Add($rustLibrary)
if ($TestFixtures) {
    $compilerArguments.Add('-DRG_TEST_FIXTURES')
    $compilerArguments.Add((Join-Path $project 'tests\game-fixtures.c'))
}
foreach ($argument in @('-DROGUE_LAYERED','-I'+$logicPath,'-I'+(Join-Path $project 'contract'),'-std=gnu11','-fwrapv','-fno-strict-aliasing','-Wno-deprecated-non-prototype','-O1','--no-entry','--js-library',(Join-Path $project 'web\library.js'),'-sMODULARIZE=1','-sEXPORT_NAME=createRogueModule','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sSTACK_SIZE=4194304','-sASSERTIONS=1','-sEXPORTED_FUNCTIONS=["_rg_run","_rg_test_repaint","_rg_snapshot_json","_rg_string_free","_rg_validate_envelope","_rg_test_save_roundtrip","_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["ccall","FS","UTF8ToString"]','-o',(Join-Path $buildPath ($OutputName + '.js')))) { $compilerArguments.Add($argument) }
$previousConfig = $env:EM_CONFIG
$previousCache = $env:EM_CACHE
try {
    $env:EM_CONFIG=$configPath
    $env:EM_CACHE=$cachePath
    & $pythonPath $emccPath @compilerArguments
    if ($LASTEXITCODE -ne 0) { throw ('C/Wasm link failed: ' + $LASTEXITCODE) }
} finally {
    $env:EM_CONFIG=$previousConfig
    $env:EM_CACHE=$previousCache
}
$files = @((Join-Path $buildPath ($OutputName+'.js')),(Join-Path $buildPath ($OutputName+'.wasm')))
$records = foreach ($file in $files) { [ordered]@{file=[System.IO.Path]::GetFileName($file);bytes=(Get-Item -LiteralPath $file).Length;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()} }
$manifestName = if ($OutputName -eq 'game') { 'build-manifest.json' } else { 'build-manifest-'+$OutputName+'.json' }
[ordered]@{built_at_utc=(Get-Date).ToUniversalTime().ToString('o');logic_source_directory=$logicPath;c_source_files=$sources.Count;rust_library=$rustLibrary;sdk_root=$SdkRoot;rust_version=((& rustc --version) -join '');c_flags=@('-DROGUE_LAYERED','-std=gnu11','-fwrapv','-fno-strict-aliasing','-O1');wasm_flags=@('MODULARIZE','ALLOW_MEMORY_GROWTH','STACK_SIZE=4194304','ASSERTIONS=1','Worker+SAB input; no Asyncify');outputs=$records} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $buildPath $manifestName) -Encoding UTF8
Write-Output ('Built ' + $OutputName + ' from ' + $sources.Count + ' C sources and Rust layers')

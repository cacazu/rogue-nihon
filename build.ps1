param(
    [string]$SdkRoot = 'C:\Users\kit\emsdk',
    [switch]$SkipRust,
    [string]$OutputName = 'game',
    [string]$LogicDirectory,
    [switch]$SkipCatalogGeneration,
    [switch]$TestFixtures,
    [switch]$KeepArtifacts
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$project = $PSScriptRoot
$pythonPath = Join-Path $SdkRoot 'python\3.13.3_64bit\python.exe'
$emccPath = Join-Path $SdkRoot 'upstream\emscripten\emcc.py'
$configPath = Join-Path $SdkRoot '.emscripten'
. (Join-Path $project 'tools\temporary-artifacts.ps1')
$artifactScope = New-RogueArtifactScope -ProjectPath $project -KeepArtifacts:$KeepArtifacts
try {
Set-RogueSdkEnvironment -Scope $artifactScope -SdkRoot $SdkRoot
$cachePath = $env:EM_CACHE
$buildPath = Join-Path $artifactScope.Path 'build'
New-Item -ItemType Directory -Path $buildPath -Force | Out-Null
$logicPath = if ($LogicDirectory) { [System.IO.Path]::GetFullPath($LogicDirectory) } else { Join-Path $project 'logic' }
$rustManifest = Join-Path $project 'rust\Cargo.toml'
$rustLibrary = Join-Path $env:CARGO_TARGET_DIR 'wasm32-unknown-emscripten\release\librogue_layers.a'
if ($SkipRust -and -not (Test-Path -LiteralPath $rustLibrary)) {
    $keptLibrary = Join-Path $project 'rust\target\wasm32-unknown-emscripten\release\librogue_layers.a'
    if (Test-Path -LiteralPath $keptLibrary) { $rustLibrary = $keptLibrary } else { $SkipRust = $false }
}
foreach ($toolPath in @($pythonPath,$emccPath,$configPath)) {
    if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw ('Missing tool: ' + $toolPath) }
}
if ($OutputName -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid output name' }
if ($OutputName -eq 'game' -and ($TestFixtures -or $LogicDirectory)) { throw 'Use a different -OutputName for a fixture or comparison build; game is reserved for the playable build.' }
& (Join-Path $project 'generate-abi.ps1')
if (-not $SkipCatalogGeneration) {
    & $pythonPath (Join-Path $project 'tools\generate_catalog.py')
    if ($LASTEXITCODE -ne 0) { throw 'Catalog generation failed' }
}
if (-not $SkipRust) {
    & cargo build --offline --locked --manifest-path $rustManifest --release --lib --target wasm32-unknown-emscripten
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
$previousSdkPython = $env:EMSDK_PYTHON
$previousSdkPath = $env:PATH
try {
    $env:EM_CONFIG=$configPath
    $env:EM_CACHE=$cachePath
    # The SDK launcher used for fresh system libraries must find this SDK's Python.
    $env:EMSDK_PYTHON=$pythonPath
    $env:PATH=(Split-Path -Parent $pythonPath)+';'+$previousSdkPath
    & $pythonPath $emccPath @compilerArguments
    if ($LASTEXITCODE -ne 0) { throw ('C/Wasm link failed: ' + $LASTEXITCODE) }
} finally {
    $env:EM_CONFIG=$previousConfig
    $env:EM_CACHE=$previousCache
    $env:EMSDK_PYTHON=$previousSdkPython
    $env:PATH=$previousSdkPath
}
$files = @((Join-Path $buildPath ($OutputName+'.js')),(Join-Path $buildPath ($OutputName+'.wasm')))
$records = foreach ($file in $files) { [ordered]@{file=[System.IO.Path]::GetFileName($file);bytes=(Get-Item -LiteralPath $file).Length;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()} }
$manifestName = if ($OutputName -eq 'game') { 'build-manifest.json' } else { 'build-manifest-'+$OutputName+'.json' }
$manifestRecord = [ordered]@{built_at_utc=(Get-Date).ToUniversalTime().ToString('o');logic_source_directory=$logicPath;c_source_files=$sources.Count;rust_library=$rustLibrary;sdk_root=$SdkRoot;rust_version=((& rustc --version) -join '');c_flags=@('-DROGUE_LAYERED','-std=gnu11','-fwrapv','-fno-strict-aliasing','-O1');wasm_flags=@('MODULARIZE','ALLOW_MEMORY_GROWTH','STACK_SIZE=4194304','ASSERTIONS=1','Worker+SAB input; no Asyncify');outputs=$records}
$manifestJson = ($manifestRecord | ConvertTo-Json -Depth 8).Replace("`r`n", "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path $buildPath $manifestName), $manifestJson, [System.Text.UTF8Encoding]::new($false))
if ($OutputName -eq 'game' -or $artifactScope.Keep) {
    # Publish the runnable files only after compilation and hashing have succeeded.
    foreach ($outputFile in @(($OutputName + '.js'),($OutputName + '.wasm'),$manifestName)) {
        Copy-Item -LiteralPath (Join-Path $buildPath $outputFile) -Destination (Join-Path $project ('build\' + $outputFile)) -Force
    }
}
Write-Output ('Built ' + $OutputName + ' from ' + $sources.Count + ' C sources and Rust layers')
if ($OutputName -ne 'game' -or $TestFixtures -or $LogicDirectory) {
    Write-Output 'Temporary build output is removed on exit unless -KeepArtifacts is specified.'
}
} finally { Close-RogueArtifactScope $artifactScope }

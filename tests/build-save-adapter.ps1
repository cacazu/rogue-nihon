param([string]$SdkRoot='C:\Users\kit\emsdk',[switch]$Diagnostics)
$ErrorActionPreference='Stop'
$saveProject=Split-Path -Parent $PSScriptRoot
$saveSources=@('vers','extern','armor','chase','command','daemon','daemons','fight','init','io','list','mach_dep','main','mdport','misc','monsters','move','new_level','options','pack','passages','potions','rings','rip','rooms','save','scrolls','state','sticks','things','weapons','wizard','xcrypt','core','knowledge','message','semantic','save_adapter')
$saveArguments=[System.Collections.Generic.List[string]]::new()
foreach($saveSource in $saveSources) {$saveArguments.Add((Join-Path $saveProject ('logic\'+$saveSource+'.c')))}
$saveArguments.Add((Join-Path $PSScriptRoot 'save-adapter.c'))
foreach($saveArgument in @('-DROGUE_LAYERED','-I'+(Join-Path $saveProject 'logic'),'-I'+(Join-Path $saveProject 'contract'),'-std=gnu11','-fwrapv','-fno-strict-aliasing','-Wno-deprecated-non-prototype','-O1','-sENVIRONMENT=node','-sEXIT_RUNTIME=1','-sASSERTIONS=2','-sSAFE_HEAP=1','-sALLOW_MEMORY_GROWTH=1','-sSTACK_SIZE=4194304','-o',(Join-Path $saveProject 'build\save-adapter.cjs'))) {$saveArguments.Add($saveArgument)}
if($Diagnostics) {$saveArguments.Add('-DRG_SAVE_DIAGNOSTICS')}
foreach($saveAuditFlag in @('-DRG_ALLOC_AUDIT','-Wl,--wrap=malloc','-Wl,--wrap=calloc','-Wl,--wrap=realloc','-Wl,--wrap=free')) {$saveArguments.Add($saveAuditFlag)}
# Capture every local compilation input so later edits cannot be mistaken for
# the source revision tested here. All sources and local headers are reviewed.
$saveTracked=@()
foreach($saveSource in $saveSources) {$saveTracked+=('logic\'+$saveSource+'.c')}
$saveTracked+=@(Get-ChildItem -LiteralPath (Join-Path $saveProject 'logic') -Filter '*.h' -File | ForEach-Object {('logic\'+$_.Name)})
$saveTracked+=@('contract\rogue_abi.h','tests\save-adapter.c','tests\build-save-adapter.ps1')
$saveHashes=@($saveTracked | Sort-Object -Unique | ForEach-Object {
    @{file=$_;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $saveProject $_)).Hash.ToLowerInvariant()}
})
$saveOldConfig=$env:EM_CONFIG
$saveOldCache=$env:EM_CACHE
try {
    $env:EM_CONFIG=Join-Path $SdkRoot '.emscripten'
    $env:EM_CACHE=Join-Path $saveProject 'build\em-cache'
    & (Join-Path $SdkRoot 'python\3.13.3_64bit\python.exe') (Join-Path $SdkRoot 'upstream\emscripten\emcc.py') @saveArguments
    if($LASTEXITCODE -ne 0) {throw 'Save-adapter fixture build failed'}
    $saveResult=& node (Join-Path $saveProject 'build\save-adapter.cjs') 2>&1
    $saveExit=$LASTEXITCODE
    $saveResult | Set-Content -LiteralPath (Join-Path $saveProject 'build\save-adapter-result.txt') -Encoding UTF8
    $saveResult | ForEach-Object {Write-Output $_}
    if($saveExit -ne 0) {throw ('Save-adapter fixture failed: '+$saveExit)}
    foreach($saveHash in $saveHashes) {
        if((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $saveProject $saveHash.file)).Hash.ToLowerInvariant() -ne $saveHash.sha256) {
            throw ('Compilation input changed during fixture build: '+$saveHash.file)
        }
    }
    $saveHashes | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $saveProject 'build\save-adapter-inputs.json') -Encoding UTF8
} finally {
    $env:EM_CONFIG=$saveOldConfig
    $env:EM_CACHE=$saveOldCache
}

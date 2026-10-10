param([string]$SdkRoot='C:\Users\kit\emsdk',[switch]$KeepArtifacts)
$ErrorActionPreference='Stop'
$messageProject=Split-Path -Parent $PSScriptRoot
. (Join-Path $messageProject 'tools\temporary-artifacts.ps1')
$messageArtifactScope=New-RogueArtifactScope -ProjectPath $messageProject -KeepArtifacts:$KeepArtifacts
$messageBuild=$env:ROGUE_ARTIFACT_BUILD
$messageOldConfig=$env:EM_CONFIG
$messageOldCache=$env:EM_CACHE
$messageEvidence=[ordered]@{schema=1;recorded_at_utc=[DateTime]::UtcNow.ToString('o');tests=[ordered]@{}}
function Message-FileRecord([string]$messageRelative) {
    $messageFile=Join-Path $messageProject $messageRelative
    if ($messageRelative.StartsWith('build\')) { $messageFile=Join-Path $messageBuild $messageRelative.Substring(6) }
    return [ordered]@{path=[IO.Path]::GetRelativePath($messageProject,$messageFile).Replace('\','/');bytes=(Get-Item -LiteralPath $messageFile).Length;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $messageFile).Hash.ToLowerInvariant()}
}
try {
    Set-RogueSdkEnvironment -Scope $messageArtifactScope -SdkRoot $SdkRoot
    $env:EM_CONFIG=Join-Path $SdkRoot '.emscripten'
    $env:EM_CACHE=Join-Path $messageArtifactScope.Path 'em-cache'
    foreach($messageFixture in @('message-capture','message-paging','semantic-capture','options-utf8')) {
        # Real semantic.c observes the real extern/init/fight data tables.
        # Unused game functions are discarded; no rule entry point is invoked.
        $messageSources=@('message','semantic','extern','init','fight')
        if($messageFixture -eq 'message-paging') {$messageSources+=@('io')}
        if($messageFixture -eq 'semantic-capture') {$messageSources=@('semantic','extern','init','fight')}
        if($messageFixture -eq 'options-utf8') {$messageSources=@('options')}
        $messageInputs=@(('tests\'+$messageFixture+'.c'),'tests\build-message-tests.ps1','contract\rogue_abi.h')
        foreach($messageSource in $messageSources) {$messageInputs+=('logic\'+$messageSource+'.c')}
        $messageInputs+=@(Get-ChildItem -LiteralPath (Join-Path $messageProject 'logic') -Filter '*.h' -File | ForEach-Object {('logic\'+$_.Name)})
        $messageDriver='tests\'+$messageFixture+'.test.mjs'
        if(Test-Path -LiteralPath (Join-Path $messageProject $messageDriver)) {$messageInputs+=$messageDriver}
        $messageBefore=@($messageInputs | Sort-Object -Unique | ForEach-Object {Message-FileRecord $_})
        $messageArguments=[System.Collections.Generic.List[string]]::new()
        foreach($messageSource in $messageSources) {$messageArguments.Add((Join-Path $messageProject ('logic\'+$messageSource+'.c')))}
        $messageArguments.Add((Join-Path $PSScriptRoot ($messageFixture+'.c')))
        foreach($messageArgument in @('-DROGUE_LAYERED','-I'+(Join-Path $messageProject 'logic'),'-I'+(Join-Path $messageProject 'contract'),'-std=gnu11','-fwrapv','-fno-strict-aliasing','-Wno-deprecated-non-prototype','-O1','-sENVIRONMENT=node','-sEXIT_RUNTIME=1','-sASSERTIONS=2','-sSAFE_HEAP=1','-sALLOW_MEMORY_GROWTH=1','-sSTACK_SIZE=4194304','-o',(Join-Path $messageBuild ($messageFixture+'.cjs')))) {$messageArguments.Add($messageArgument)}
        $messageCompile=& (Join-Path $SdkRoot 'python\3.13.3_64bit\python.exe') (Join-Path $SdkRoot 'upstream\emscripten\emcc.py') @messageArguments 2>&1
        if($LASTEXITCODE -ne 0) {throw ($messageFixture+' build failed')}
        if(Test-Path -LiteralPath (Join-Path $messageProject $messageDriver)) {
            $messageRun=& node (Join-Path $messageProject $messageDriver) 2>&1
        } else {
            $messageRun=& node (Join-Path $messageBuild ($messageFixture+'.cjs')) 2>&1
        }
        $messageExit=$LASTEXITCODE
        $messageLog='build\'+$messageFixture+'-test.log'
        @($messageCompile)+@($messageRun) | Set-Content -LiteralPath (Join-Path $messageBuild ($messageFixture+'-test.log')) -Encoding UTF8
        @($messageRun) | ForEach-Object {Write-Output $_}
        if($messageExit -ne 0) {throw ($messageFixture+' checks failed')}
        foreach($messageHash in $messageBefore) {
            if((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $messageProject $messageHash.path)).Hash.ToLowerInvariant() -ne $messageHash.sha256) {
                throw ('Compilation input changed during '+$messageFixture+': '+$messageHash.path)
            }
        }
        $messageResult=($messageRun | Select-Object -Last 1) | ConvertFrom-Json
        $messageScope=$messageFixture.Replace('-','_')
        $messageChecks=@($messageResult.PSObject.Properties | Where-Object {$_.Value -eq 'pass'}).Count
        $messageCheckUnit='reported_categories'
        if($messageResult.checks -is [int] -or $messageResult.checks -is [long]) {$messageChecks=$messageResult.checks;$messageCheckUnit='assertions'}
        $messageFiles=@($messageBefore)+@(Message-FileRecord $messageLog)+@(Message-FileRecord ('build\'+$messageFixture+'.cjs'))+@(Message-FileRecord ('build\'+$messageFixture+'.wasm'))
        $messageEvidence.tests[$messageScope]=[ordered]@{status='passed';exit_code=$messageExit;checks=$messageChecks;check_unit=$messageCheckUnit;result=$messageResult;files=$messageFiles}
    }
    $messageEvidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $messageBuild 'c-supplementary-evidence.json') -Encoding UTF8
} finally {
    $env:EM_CONFIG=$messageOldConfig
    $env:EM_CACHE=$messageOldCache
    Close-RogueArtifactScope $messageArtifactScope
}

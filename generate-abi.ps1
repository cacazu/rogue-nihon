$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$header = [System.IO.File]::ReadAllText((Join-Path $project 'contract\rogue_abi.h'))
$abiCount = 0
$rustLines = [System.Collections.Generic.List[string]]::new()
$rustLines.Add('// Generated from contract/rogue_abi.h. Do not edit.')
$rustLines.Add('#![allow(dead_code)] // All constants are public parts of the cross-language ABI.')
foreach ($match in [regex]::Matches($header,'(?m)^#define (RG_[A-Z0-9_]+) (0x[0-9a-fA-F]+|[0-9]+)\s*$')) {
    $name = $match.Groups[1].Value
    $number = $match.Groups[2].Value
    $abiCount++
    $rustLines.Add(('pub const ' + $name + ': u32 = ' + $number + ';'))
}
New-Item -ItemType Directory -Path (Join-Path $project 'rust\crates\contract\src') -Force | Out-Null
[System.IO.File]::WriteAllText((Join-Path $project 'rust\crates\contract\src\abi.rs'),($rustLines -join "`n") + "`n",[System.Text.UTF8Encoding]::new($false))
Write-Output ('Generated ' + $abiCount + ' Rust ABI constants')

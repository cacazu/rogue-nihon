param([int]$Port = 4173, [switch]$Lan, [string]$Address)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be 1..65535' }
$serverArguments = @((Join-Path $PSScriptRoot 'web\server.mjs'), $Port)
if ($Lan) {
    if (-not $Address) {
        $networks = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address })
        if ($networks.Count -ne 1) { throw 'Specify the LAN IPv4 address with -Address.' }
        $Address = $networks[0].IPv4Address[0].IPAddress
    }
    $parsedAddress = $null
    if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $Address -eq '0.0.0.0') {
        throw 'Address must be the PC LAN IPv4 address.'
    }
    $opensslCommand = Get-Command openssl -ErrorAction SilentlyContinue
    $opensslPath = if ($opensslCommand) { $opensslCommand.Source } else { Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe' }
    if (-not (Test-Path -LiteralPath $opensslPath)) { throw 'OpenSSL is required for the LAN HTTPS certificate (Git for Windows includes it).' }
    $certificateDirectory = Join-Path $PSScriptRoot '.local\lan'
    New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
    $certificate = Join-Path $certificateDirectory "$Address-cert.pem"
    $privateKey = Join-Path $certificateDirectory "$Address-key.pem"
    $renew = -not ((Test-Path -LiteralPath $certificate) -and (Test-Path -LiteralPath $privateKey))
    if (-not $renew) {
        & $opensslPath x509 -checkend 86400 -noout -in $certificate *> $null
        $renew = $LASTEXITCODE -ne 0
    }
    if ($renew) {
        & $opensslPath req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 -keyout $privateKey -out $certificate -subj '/CN=Rogue LAN' -addext "subjectAltName=IP:$Address,IP:127.0.0.1,DNS:localhost" *> $null
        if ($LASTEXITCODE -ne 0) { throw 'LAN certificate generation failed.' }
    }
    Write-Host 'LAN HTTPS uses a local certificate. Accept its browser warning on your own LAN.'
    $serverArguments += @($Address, $certificate, $privateKey)
} elseif ($Address) {
    throw 'Use -Lan together with -Address.'
}
& node @serverArguments
if ($LASTEXITCODE -ne 0) { throw 'Preview stopped with an error' }

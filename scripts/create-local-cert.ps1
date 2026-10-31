param(
  [Parameter(Position = 0)]
  [ValidatePattern('^(?:\d{1,3}\.){3}\d{1,3}$')]
  [string]$AdditionalIp = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot 'shared\config.ts'
$ConfigText = Get-Content -Path $ConfigPath -Raw

function Get-ConfigString([string]$Name, [string]$Fallback) {
  $Match = [regex]::Match($ConfigText, $Name + "\s*:\s*'([^']*)'")
  if ($Match.Success) { return $Match.Groups[1].Value }
  return $Fallback
}

if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
  throw 'New-SelfSignedCertificate is unavailable. Run this script in Windows PowerShell 5.1 or newer on Windows.'
}

if ($AdditionalIp) {
  $Octets = $AdditionalIp.Split('.')
  if ($Octets.Count -ne 4 -or ($Octets | Where-Object { [int]$_ -gt 255 }).Count -gt 0) {
    throw "Invalid IPv4 address: $AdditionalIp"
  }
}

$CertDirectory = Join-Path $ProjectRoot 'certs'
$PfxPath = Join-Path $CertDirectory (Get-ConfigString 'windowsPfxFile' 'localhost.pfx')
$PublicCertificatePath = Join-Path $CertDirectory (Get-ConfigString 'windowsPublicCertificateFile' 'localhost.cer')
$PfxPasswordText = Get-ConfigString 'pfxPassphrase' 'visual-field-dev'
$PfxPassword = ConvertTo-SecureString -String $PfxPasswordText -Force -AsPlainText

New-Item -ItemType Directory -Path $CertDirectory -Force | Out-Null

$DetectedIpAddresses = @(
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object {
      $_.IPAddress -ne '127.0.0.1' -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.AddressState -eq 'Preferred'
    } |
    Select-Object -ExpandProperty IPAddress -Unique
)

$CertificateIpAddresses = @('127.0.0.1') + $DetectedIpAddresses
if ($AdditionalIp) { $CertificateIpAddresses += $AdditionalIp }
$CertificateIpAddresses = @($CertificateIpAddresses | Sort-Object -Unique)

$SanEntries = @('DNS=localhost', 'DNS=visual-field.local')
$SanEntries += $CertificateIpAddresses | ForEach-Object { "IPAddress=$_" }
$SanExtension = '2.5.29.17={text}' + ($SanEntries -join '&')

$Certificate = New-SelfSignedCertificate `
  -Subject 'CN=visual-field.local' `
  -FriendlyName 'Visual Field Local Development' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(1) `
  -TextExtension @($SanExtension, '2.5.29.37={text}1.3.6.1.5.5.7.3.1')

Export-PfxCertificate -Cert $Certificate -FilePath $PfxPath -Password $PfxPassword | Out-Null
Export-Certificate -Cert $Certificate -FilePath $PublicCertificatePath -Type CERT | Out-Null
Import-Certificate -FilePath $PublicCertificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

Write-Host ''
Write-Host 'Created without OpenSSL:' -ForegroundColor Green
Write-Host "  $PfxPath"
Write-Host "  $PublicCertificatePath"
Write-Host ''
Write-Host 'The Node server loads localhost.pfx automatically.'
Write-Host 'The certificate is now trusted for the current Windows user.' -ForegroundColor Green
Write-Host 'Certificate IPv4 addresses:'
$CertificateIpAddresses | ForEach-Object { Write-Host "  $_" }
Write-Host ''
Write-Host 'Install localhost.cer on the phone as a trusted CA certificate, or accept the browser warning.'
Write-Host 'Do not share localhost.pfx; it contains the private key.' -ForegroundColor Yellow

# SPDX-License-Identifier: AGPL-3.0-only
# Fresh production secrets for Windows (docs: /docs/installation/windows).
#   .\scripts\gen-secrets.ps1 .env    fills every EMPTY secret in .env in place
#                                     (existing values are never overwritten)
# Same keys and formats as gen-secrets.sh. Works in Windows PowerShell 5.1+.
param([Parameter(Mandatory = $true)][string]$EnvFile)
$ErrorActionPreference = "Stop"

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
function New-RandomBytes([int]$Count) { $b = New-Object byte[] $Count; $rng.GetBytes($b); return ,$b }
function New-Hex([int]$Count) { -join ((New-RandomBytes $Count) | ForEach-Object { $_.ToString("x2") }) }
function New-Base64([int]$Count) { [Convert]::ToBase64String((New-RandomBytes $Count)) }

$keys = @(
  @{ Name = "POSTGRES_PASSWORD"; New = { New-Hex 24 } },
  @{ Name = "APP_DB_PASSWORD"; New = { New-Hex 24 } },
  @{ Name = "BETTER_AUTH_SECRET"; New = { New-Base64 48 } },
  @{ Name = "CREDENTIALS_ENCRYPTION_KEY"; New = { New-Base64 32 } },
  @{ Name = "CRON_SECRET"; New = { New-Hex 32 } }
)

$path = (Resolve-Path -LiteralPath $EnvFile).Path
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($l in [System.IO.File]::ReadAllLines($path)) { $lines.Add($l) }

foreach ($k in $keys) {
  $name = $k.Name
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$name=") { $index = $i; break } }
  if ($index -ge 0 -and $lines[$index] -ne "$name=") {
    Write-Output "kept   $name (already set)"
  } elseif ($index -ge 0) {
    $lines[$index] = "$name=$(& $k.New)"
    Write-Output "filled $name"
  } else {
    $lines.Add("$name=$(& $k.New)")
    Write-Output "added  $name"
  }
}
# UTF-8 without BOM, LF line endings (read by Docker Compose).
[System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))

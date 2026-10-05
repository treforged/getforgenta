# install-local-stack.ps1 - one-time setup for a LOCAL copy of Forgenta (ask d5c183b3, Tre said yes 2026-10-04).
#
# WHAT IT DOES (needs admin; run elevated):
#   1. Enables WSL 2 without installing a Linux distribution (Docker Desktop brings its own).
#   2. Installs Docker Desktop with winget.
# WHAT IT DOES NOT DO:
#   - It does NOT reboot. WSL needs a reboot before Docker can start; reboot when it suits you,
#     because a reboot closes every open Claude desk.
#   - It does not copy any data. Ada does that after the reboot, and only YOUR rows.
#
# UNDO (elevated):
#   winget uninstall -e --id Docker.DockerDesktop
#   wsl --uninstall
#
# Exit codes: 0 both steps done, 1 a step failed (it says which), 2 not elevated.

$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'install-local-stack.log'
function Say($m) { $line = "$(Get-Date -Format s)  $m"; Write-Host $line; Add-Content -Path $log -Value $line -Encoding utf8 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Say 'FAIL: not elevated. Run this from an admin PowerShell.'; exit 2 }

$done = 0
try {
  Say 'Step 1 of 2: enabling WSL 2 (no distribution)...'
  & wsl.exe --install --no-distribution
  if ($LASTEXITCODE -ne 0) { throw "wsl --install exited $LASTEXITCODE" }
  $done++
  Say 'Step 1 of 2: done.'
} catch { Say "FAIL step 1: $($_.Exception.Message)" }

try {
  Say 'Step 2 of 2: installing Docker Desktop (winget)...'
  & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
  $done++
  Say 'Step 2 of 2: done.'
} catch { Say "FAIL step 2: $($_.Exception.Message)" }

Say "$done of 2 done. Reboot when convenient, then tell Ada. Undo: winget uninstall -e --id Docker.DockerDesktop; wsl --uninstall"
if ($done -eq 2) { Start-Sleep -Seconds 8; exit 0 } else { Start-Sleep -Seconds 20; exit 1 }

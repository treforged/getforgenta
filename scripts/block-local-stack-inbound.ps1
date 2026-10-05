# block-local-stack-inbound.ps1 - run elevated (UAC). Takes no arguments.
#
# WHY: `supabase start` publishes the local stack on 0.0.0.0 (API 54321, Postgres 54322,
# Studio 54323, mail 54324, analytics 54327), and Docker Desktop's installer added an
# inbound ALLOW rule for its backend on Private AND Public profiles. Studio and Postgres
# have no real auth locally (password "postgres"), so without this rule anything on the
# LAN or the tailnet could read the copy of Tre's financial rows the local stack holds.
# A BLOCK rule wins over an ALLOW rule in Windows Firewall, so this closes those ports to
# other machines while 127.0.0.1 keeps working (loopback is not filtered).
#
# UNDO: Remove-NetFirewallRule -DisplayName "Forgenta local stack - block inbound"

$ErrorActionPreference = 'Stop'
$name = 'Forgenta local stack - block inbound'
$log = Join-Path $PSScriptRoot 'block-local-stack-inbound.log'

try {
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Block -Protocol TCP `
        -LocalPort '54321-54329' -Profile Any | Out-Null
    $r = Get-NetFirewallRule -DisplayName $name
    $p = $r | Get-NetFirewallPortFilter
    if ($r.Action -ne 'Block' -or $r.Enabled -ne 'True' -or $p.LocalPort -ne '54321-54329') {
        throw "read-back mismatch: action=$($r.Action) enabled=$($r.Enabled) ports=$($p.LocalPort)"
    }
    "$(Get-Date -Format s)  1 of 1 done. Rule '$name' blocks inbound TCP 54321-54329 on all profiles. Undo: Remove-NetFirewallRule -DisplayName `"$name`"" | Out-File $log -Encoding utf8
    exit 0
} catch {
    "$(Get-Date -Format s)  FAIL 0 of 1: $($_.Exception.Message)" | Out-File $log -Encoding utf8
    exit 1
}

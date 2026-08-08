param()

# Refreshes the graphify knowledge graph (only when source files actually
# changed) and mirrors it into the Obsidian vault.
#
# Called from two places:
#   - scripts/daily-backup-and-sync.ps1  (weekly "Forgenta Backup Sync")
#   - scripts/register-graph-sync-task.ps1 -> "Forgenta Graph Sync" (daily)
# Both paths are safe: when nothing changed the rebuild is skipped and only
# the copy runs.
#
# Every run appends to scripts/graph-sync.log (gitignored) so a scheduled run
# can be audited after the fact instead of assumed to have worked.

$RepoDir   = "C:\Users\tvonh\Desktop\getforgenta"
$GraphDir  = "C:\Users\tvonh\Desktop\claudecontext\code-graph"
$GraphSrc  = "$RepoDir\graphify-out\GRAPH_REPORT.md"
$GraphJson = "$RepoDir\graphify-out\graph.json"
$WikiSrc   = "$RepoDir\graphify-out\wiki"
$LogFile   = "$RepoDir\scripts\graph-sync.log"

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

Write-Log "run start"

# Only rebuild if source files changed since last graph build
$needsRebuild = $false
if (Test-Path $GraphJson) {
    $graphTime = (Get-Item $GraphJson).LastWriteTime
    $changed = Get-ChildItem "$RepoDir\src","$RepoDir\supabase" -Recurse -File -Include "*.ts","*.tsx" -ErrorAction SilentlyContinue |
               Where-Object { $_.LastWriteTime -gt $graphTime } |
               Select-Object -First 1
    if ($changed) { $needsRebuild = $true }
} else {
    $needsRebuild = $true
}

if ($needsRebuild) {
    Write-Log "sources changed since last build - running 'python -m graphify update .'"
    Set-Location $RepoDir
    $output = python -m graphify update . 2>&1
    Write-Log "graphify exit code $LASTEXITCODE"
    if ($output) { Write-Log ("graphify output: " + ($output | Out-String).Trim()) }
} else {
    Write-Log "no source changes since last build - skipping rebuild"
}

# Sync to Obsidian
if (-not (Test-Path $GraphSrc)) {
    Write-Log "GRAPH_REPORT.md missing at $GraphSrc - nothing to sync, exiting"
    exit 0
}

New-Item -ItemType Directory -Force $GraphDir | Out-Null
Copy-Item $GraphSrc "$GraphDir\GRAPH_REPORT.md" -Force
Write-Log "copied GRAPH_REPORT.md -> $GraphDir"

if (Test-Path $WikiSrc) {
    Copy-Item $WikiSrc "$GraphDir\wiki" -Recurse -Force
    Write-Log "copied wiki/ -> $GraphDir\wiki"
} else {
    Write-Log "no wiki/ directory to copy"
}

Write-Log "run complete"

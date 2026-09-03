param(
    # Skip the graphify rebuild and do the cheap copy only.
    #
    # THE STOP HOOK PASSES THIS, AND THAT IS THE WHOLE POINT (2026-09-02).
    # Tre: "the old forgenta terminal tab is still open. it should auto close."
    # It could not: its Stop chain was wedged on THIS script. graph-sync.log line
    # 4415 records `2026-09-01 12:05:25 run start` followed by "sources changed -
    # running graphify update", and then NOTHING - no exit code, no "run complete"
    # - while a second session's run at 12:08:45 finished in 44 seconds. Two
    # concurrent rebuilds over one shared graphify-out, which is routine on a
    # machine that runs a dozen sessions in one tree, and the loser hangs forever.
    # The terminal sat at "running stop hooks 1/4" for the rest of the day and the
    # auto-exit hook, wired fourth, never got to run.
    #
    # A 31,000-node rebuild does not belong in the path a human is waiting on to
    # close a window. The daily "Forgenta Graph Sync" scheduled task and the weekly
    # backup already own the rebuild; the hook now only mirrors what they produced.
    [switch]$SkipRebuild
)

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

# DERIVED, NEVER HARDCODED - see daily-backup-and-sync.ps1 for what the old
# absolute paths cost. $GraphDir was the more dangerous of the two: it pointed at
# the pre-move Desktop\claudecontext\code-graph, and the copy step below does
# New-Item -Force on it, so every run RE-CREATED the dead folder and wrote the
# graph into a directory nothing reads. A failure that manufactures its own
# evidence of success is the worst shape a failure can have.
if (-not $PSScriptRoot) {
    # Split-Path throws on an empty string; the guard must precede the call.
    throw "sync-graph-to-obsidian.ps1 must be run as a file (PSScriptRoot is empty)."
}
$RepoDir   = Split-Path -Parent $PSScriptRoot
$GraphDir  = Join-Path (Split-Path -Parent $RepoDir) "claudecontext\code-graph"
$GraphSrc  = "$RepoDir\graphify-out\GRAPH_REPORT.md"
$GraphJson = "$RepoDir\graphify-out\graph.json"
$WikiSrc   = "$RepoDir\graphify-out\wiki"
$LogFile   = "$RepoDir\scripts\graph-sync.log"

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

Write-Log "run start"

# SINGLE INSTANCE. Even with the rebuild skipped, two sessions ending at once would
# race on the same copy. A stale lock (older than an hour, so a crashed run cannot
# block forever) is taken over rather than obeyed.
$LockFile = "$RepoDir\scripts\.graph-sync.lock"
if (Test-Path $LockFile) {
    $age = (Get-Date) - (Get-Item $LockFile).LastWriteTime
    if ($age.TotalMinutes -lt 60) {
        Write-Log "another run holds the lock (age $([int]$age.TotalMinutes)m) - exiting without waiting"
        exit 0
    }
    Write-Log "stale lock ($([int]$age.TotalMinutes)m old) - taking it over"
}
Set-Content -Path $LockFile -Value $PID -Encoding utf8

try {

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

$skippedByRequest = $false
if ($SkipRebuild -and $needsRebuild) {
    Write-Log "sources changed but -SkipRebuild was passed - the scheduled task owns rebuilds"
    $needsRebuild = $false
    $skippedByRequest = $true
}

if ($needsRebuild) {
    Write-Log "sources changed since last build - running 'python -m graphify update .'"
    Set-Location $RepoDir
    $output = python -m graphify update . 2>&1
    Write-Log "graphify exit code $LASTEXITCODE"
    if ($output) { Write-Log ("graphify output: " + ($output | Out-String).Trim()) }
} elseif (-not $skippedByRequest) {
    Write-Log "no source changes since last build - skipping rebuild"
}

# Sync to Obsidian
if (-not (Test-Path $GraphSrc)) {
    Write-Log "GRAPH_REPORT.md missing at $GraphSrc - nothing to sync, exiting"
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
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

}
finally {
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

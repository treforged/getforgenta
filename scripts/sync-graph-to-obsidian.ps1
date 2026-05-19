param()

$RepoDir  = "C:\Users\tvonh\Desktop\getforgenta"
$GraphDir = "C:\Users\tvonh\Desktop\claudecontext\code-graph"
$GraphSrc = "$RepoDir\graphify-out\GRAPH_REPORT.md"
$GraphJson = "$RepoDir\graphify-out\graph.json"
$WikiSrc  = "$RepoDir\graphify-out\wiki"

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
    Set-Location $RepoDir
    python -m graphify update . 2>&1
}

# Sync to Obsidian
if (-not (Test-Path $GraphSrc)) { exit 0 }
New-Item -ItemType Directory -Force $GraphDir | Out-Null
Copy-Item $GraphSrc "$GraphDir\GRAPH_REPORT.md" -Force
if (Test-Path $WikiSrc) {
    Copy-Item $WikiSrc "$GraphDir\wiki" -Recurse -Force
}

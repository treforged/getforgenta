param()

$RepoDir  = "C:\Users\tvonh\Desktop\getforgenta"
$GraphDir = "C:\Users\tvonh\Desktop\claudecontext\code-graph"
$GraphSrc = "$RepoDir\graphify-out\GRAPH_REPORT.md"
$WikiSrc  = "$RepoDir\graphify-out\wiki"

Set-Location $RepoDir

Write-Host "[graphify] Updating knowledge graph..."
python -m graphify update . 2>&1

if (-not (Test-Path $GraphSrc)) {
    Write-Host "[graphify] WARNING: GRAPH_REPORT.md not found - skipping Obsidian sync."
    exit 0
}

New-Item -ItemType Directory -Force $GraphDir | Out-Null
Copy-Item $GraphSrc "$GraphDir\GRAPH_REPORT.md" -Force
Write-Host "[obsidian] Synced GRAPH_REPORT.md"

if (Test-Path $WikiSrc) {
    Copy-Item $WikiSrc "$GraphDir\wiki" -Recurse -Force
    Write-Host "[obsidian] Synced wiki"
}

Write-Host "[sync] Done."

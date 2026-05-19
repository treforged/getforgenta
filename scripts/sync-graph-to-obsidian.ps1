param()

$GraphDir = "C:\Users\tvonh\Desktop\claudecontext\code-graph"
$GraphSrc = "C:\Users\tvonh\Desktop\getforgenta\graphify-out\GRAPH_REPORT.md"
$WikiSrc  = "C:\Users\tvonh\Desktop\getforgenta\graphify-out\wiki"

if (-not (Test-Path $GraphSrc)) { exit 0 }

New-Item -ItemType Directory -Force $GraphDir | Out-Null
Copy-Item $GraphSrc "$GraphDir\GRAPH_REPORT.md" -Force

if (Test-Path $WikiSrc) {
    Copy-Item $WikiSrc "$GraphDir\wiki" -Recurse -Force
}

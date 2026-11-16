# Synthetic-only collector boundary check. No actual process/network query is used.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('xiumi-diagnostic-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'scripts') -Force | Out-Null
try {
    $scriptPath = Join-Path $root 'scripts/collect-network-diagnostics.ps1'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'collect-network-diagnostics.ps1') -Destination $scriptPath
    function Get-CimInstance { param($ClassName) if ($ClassName -ne 'Win32_OperatingSystem') { throw 'Unexpected query' }; @{ FreePhysicalMemory = 1024; TotalVisibleMemorySize = 4096; Secret = 'private-sentinel' } }
    function Get-Process { param($Name, $ErrorAction) @{ WorkingSet64 = 16; CommandLine = 'private-sentinel'; Path = 'private-sentinel' } }
    function Get-NetTCPConnection { param($ErrorAction) @(@{ LocalAddress = '127.0.0.1'; RemoteAddress = '192.0.2.1'; State = 'Established' }, @{ LocalAddress = '192.0.2.2'; RemoteAddress = '192.0.2.1'; State = 'TimeWait' }) }
    & $scriptPath -Phase before-e2e
    $raw = Get-Content -Raw -LiteralPath (Join-Path $root 'diagnostic-results/before-e2e.json')
    $report = $raw | ConvertFrom-Json
    if ($raw -match 'private-sentinel|192\.0\.2|127\.0\.0\.1|CommandLine|LocalAddress|RemoteAddress') { throw 'Private diagnostic field escaped' }
    if ($report.memory.freePhysicalKiB -ne 1024 -or $report.processes.Count -ne 3 -or $report.tcp.Count -ne 2 -or $report.unavailable.Count -ne 0) { throw 'Unexpected synthetic summary' }
    function Get-NetTCPConnection { throw 'private-sentinel' }
    & $scriptPath -Phase failed-e2e
    $raw = Get-Content -Raw -LiteralPath (Join-Path $root 'diagnostic-results/failed-e2e.json')
    $report = $raw | ConvertFrom-Json
    if ($raw -match 'private-sentinel' -or $report.unavailable -notcontains 'tcp') { throw 'Diagnostic failure handling failed' }
    Write-Output 'Synthetic diagnostic boundary checks passed'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}

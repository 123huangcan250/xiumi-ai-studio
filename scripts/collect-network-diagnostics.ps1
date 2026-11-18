param([ValidateSet('before-e2e','failed-e2e')][string]$Phase)
# Diagnostic only. No network settings, process control, paths, command lines or addresses in output.
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ schema = 1; phase = $Phase; timestampUtc = [DateTime]::UtcNow.ToString('o'); memory = $null; processes = @(); tcp = @(); unavailable = @() }
try {
    $os = Get-CimInstance Win32_OperatingSystem
    $report.memory = @{ freePhysicalKiB = [long]$os.FreePhysicalMemory; totalVisibleKiB = [long]$os.TotalVisibleMemorySize }
} catch { $report.unavailable += 'memory' }
try {
    foreach ($name in @('node','chrome','chrome-headless-shell')) {
        $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        $sum = ($processes | Measure-Object -Property WorkingSet64 -Sum).Sum
        $report.processes += @{ family = $name; count = $processes.Count; workingSetBytes = [long]$sum }
    }
} catch { $report.unavailable += 'processes' }
try {
    $counts = @{}
    foreach ($connection in @(Get-NetTCPConnection -ErrorAction Stop)) {
        $loopback = $connection.LocalAddress -in @('127.0.0.1','::1') -or $connection.RemoteAddress -in @('127.0.0.1','::1')
        $state = [string]$connection.State
        if ($state -notin @('Closed','Listen','SynSent','SynReceived','Established','FinWait1','FinWait2','CloseWait','Closing','LastAck','TimeWait','DeleteTCB','Bound')) { $state = 'Other' }
        $key = "$state|$loopback"
        if (-not $counts.ContainsKey($key)) { $counts[$key] = @{ state = $state; loopback = [bool]$loopback; count = 0 } }
        $counts[$key].count++
    }
    $report.tcp = @($counts.Values)
} catch { $report.unavailable += 'tcp' }
try {
    $dir = Join-Path $PSScriptRoot '../diagnostic-results'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dir "$Phase.json") -Encoding utf8
} catch { Write-Output 'Network diagnostic output unavailable' }
# This script never decides whether E2E passed. The original test step retains its own exit status.

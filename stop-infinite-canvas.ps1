$runtimeRoot = Join-Path (Split-Path -Parent $PSCommandPath) ".runtime"

foreach ($name in "backend", "frontend", "h3-adapter", "h3-engine") {
    $pidFile = Join-Path $runtimeRoot "$name.pid"
    if (-not (Test-Path -LiteralPath $pidFile)) {
        continue
    }

    try {
        $processInfo = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $process = Get-Process -Id $processInfo.ProcessId -ErrorAction Stop
        $recordedStartTime = [datetime]$processInfo.StartTimeUtc
        $startTimeDelta = [math]::Abs(($process.StartTime.ToUniversalTime() - $recordedStartTime.ToUniversalTime()).TotalSeconds)
        $sameProcess = $startTimeDelta -lt 2
        if ($sameProcess) {
            taskkill.exe /PID $processInfo.ProcessId /T /F | Out-Null
        }
    } catch {
        Write-Warning "Skipped stale $name process record."
    }

    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Infinite Canvas services stopped."

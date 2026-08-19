param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSCommandPath
$webRoot = Join-Path $appRoot "web"
$runtimeRoot = Join-Path $appRoot ".runtime"
$goExe = "E:\codex\tools\go\bin\go.exe"
$serverExe = Join-Path $runtimeRoot "infinite-canvas-server.exe"
$h3Root = Join-Path $runtimeRoot "h3-runtime\work"
$h3EngineApp = Join-Path $h3Root "ComfyUI\main.py"
$h3SagePython = Join-Path $runtimeRoot "h3-sage-cu128\Scripts\python.exe"
$h3AdapterApp = Join-Path $h3Root "webui\app.py"
$h3AdapterVenvPython = Join-Path $h3Root "venv\Scripts\python.exe"
$h3AdapterFallbackPython = "E:\codex\youmedhub\local-asr\runtime\python\cpython-3.12.13-windows-x86_64-none\python.exe"
$h3AdapterSitePackages = Join-Path $h3Root "venv\Lib\site-packages"
$h3InputDirectory = Join-Path $runtimeRoot "h3-input"
$h3OutputDirectory = Join-Path $runtimeRoot "h3-output"

function Test-ListeningPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect("127.0.0.1", $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-PythonExecutable([string]$FilePath) {
    if (-not (Test-Path -LiteralPath $FilePath)) {
        return $false
    }

    & $FilePath -c "import sys" 2>$null
    return $LASTEXITCODE -eq 0
}

function Test-H3SageRuntime {
    if (-not (Test-PythonExecutable $h3SagePython)) {
        return $false
    }

    # The Sage runtime keeps the original H3 packages as a .pth dependency layer.
    # This verifies the actual CUDA path before using it as the default engine.
    & $h3SagePython -c "import torch; from sageattention import sageattn; assert torch.cuda.is_available()" 2>$null
    return $LASTEXITCODE -eq 0
}

function Start-AppProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )

    $startOptions = @{
        FilePath = $FilePath
        WorkingDirectory = $WorkingDirectory
        WindowStyle = "Hidden"
        RedirectStandardOutput = Join-Path $runtimeRoot "$Name.out.log"
        RedirectStandardError = Join-Path $runtimeRoot "$Name.err.log"
        PassThru = $true
    }
    if ($ArgumentList.Count -gt 0) {
        $startOptions.ArgumentList = $ArgumentList
    }
    $process = Start-Process @startOptions
    @{
        ProcessId = $process.Id
        StartTimeUtc = $process.StartTime.ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot "$Name.pid") -Encoding ascii
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $h3InputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $h3OutputDirectory | Out-Null
$pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
Remove-Item -LiteralPath Env:\PATH -ErrorAction SilentlyContinue
if (-not [string]::IsNullOrWhiteSpace($pathValue)) {
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
}
$env:GOMODCACHE = Join-Path $runtimeRoot "go-mod-cache"
$env:GOCACHE = Join-Path $runtimeRoot "go-build-cache"

if (-not (Test-ListeningPort 8188)) {
    if ((Test-Path -LiteralPath $h3EngineApp) -and (Test-H3SageRuntime)) {
        $env:HTTP_PROXY = ""
        $env:HTTPS_PROXY = ""
        $env:ALL_PROXY = ""
        $env:NO_PROXY = "*"
        Start-AppProcess -Name "h3-engine" -FilePath $h3SagePython -ArgumentList @(
            $h3EngineApp,
            "--listen", "127.0.0.1",
            "--port", "8188",
            "--input-directory", $h3InputDirectory,
            "--output-directory", $h3OutputDirectory,
            "--lowvram",
            "--disable-auto-launch",
            "--use-sage-attention"
        ) -WorkingDirectory (Split-Path -Parent $h3EngineApp)
    } else {
        Write-Warning "MiniMax-H3 SageAttention engine was not started because its verified local runtime was unavailable."
    }
}

if (-not (Test-ListeningPort 7860)) {
    $h3AdapterPython = $null
    $useH3SitePackages = $false
    if ((Test-Path -LiteralPath $h3AdapterApp) -and (Test-PythonExecutable $h3AdapterVenvPython)) {
        $h3AdapterPython = $h3AdapterVenvPython
    } elseif ((Test-Path -LiteralPath $h3AdapterApp) -and (Test-Path -LiteralPath $h3AdapterSitePackages) -and (Test-PythonExecutable $h3AdapterFallbackPython)) {
        # The original Python 3.12 runtime was removed, but its H3 packages remain intact.
        # Use the locally available compatible runtime without downloading anything.
        $h3AdapterPython = $h3AdapterFallbackPython
        $useH3SitePackages = $true
    }

    if ($null -ne $h3AdapterPython) {
        $previousPythonPath = $env:PYTHONPATH
        try {
            if ($useH3SitePackages) {
                $env:PYTHONPATH = $h3AdapterSitePackages
            }
            $env:HTTP_PROXY = ""
            $env:HTTPS_PROXY = ""
            $env:ALL_PROXY = ""
            $env:NO_PROXY = "*"
            Start-AppProcess -Name "h3-adapter" -FilePath $h3AdapterPython -ArgumentList @($h3AdapterApp) -WorkingDirectory (Split-Path -Parent $h3AdapterApp)
        } finally {
            if ($null -eq $previousPythonPath) {
                Remove-Item -LiteralPath Env:\PYTHONPATH -ErrorAction SilentlyContinue
            } else {
                $env:PYTHONPATH = $previousPythonPath
            }
        }
    } else {
        Write-Warning "MiniMax-H3 adapter was not started because no compatible local Python runtime was found."
    }
}

if (-not (Test-ListeningPort 8080)) {
    if (-not (Test-Path -LiteralPath $goExe)) {
        throw "Local Go toolchain not found: $goExe"
    }

    Push-Location $appRoot
    try {
        & $goExe build -o $serverExe .
        if ($LASTEXITCODE -ne 0) {
            throw "Backend build failed. Check the source or run the launcher again."
        }
    } finally {
        Pop-Location
    }

    Start-AppProcess -Name "backend" -FilePath $serverExe -ArgumentList @() -WorkingDirectory $appRoot
}

if (-not (Test-ListeningPort 3000)) {
    Start-AppProcess -Name "frontend" -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "npm.cmd run dev") -WorkingDirectory $webRoot
}

for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000" -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            if (-not $NoBrowser) {
                Start-Process "http://127.0.0.1:3000"
            }
            return
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

throw "The app did not start within 60 seconds. Check logs in $runtimeRoot."

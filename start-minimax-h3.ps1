param(
    [ValidateSet("fl2va", "ref2va")]
    [string]$Variant = "fl2va",
    [int]$Port = 0,
    [int]$NumGpus = 4,
    [int]$UlyssesDegree = 4,
    [switch]$Force,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$h3Launcher = Join-Path $PSScriptRoot ".runtime\h3-runtime\work\start_h3.ps1"
if (-not (Test-Path -LiteralPath $h3Launcher)) {
    throw "MiniMax H3 local launcher not found: $h3Launcher"
}
$launcherArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $h3Launcher)
if ($NoBrowser) {
    $launcherArgs += "-NoBrowser"
}
& powershell.exe $launcherArgs
return

if ($Port -le 0) {
    $Port = if ($Variant -eq "ref2va") { 30011 } else { 30010 }
}

function Read-NvidiaGpuMemory {
    $nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidia) {
        return @()
    }
    $rows = & $nvidia.Source --query-gpu=name,memory.total --format=csv,noheader,nounits
    if ($LASTEXITCODE -ne 0) {
        return @()
    }
    return @($rows | ForEach-Object {
        $parts = $_ -split ","
        if ($parts.Count -lt 2) {
            return
        }
        [pscustomobject]@{
            Name = $parts[0].Trim()
            MemoryMiB = [int]$parts[1].Trim()
        }
    })
}

$gpus = @(Read-NvidiaGpuMemory)
$maxMemoryGiB = if ($gpus.Count) { [math]::Round(($gpus | Measure-Object -Property MemoryMiB -Maximum).Maximum / 1024, 1) } else { 0 }

if (-not $Force) {
    if ($gpus.Count -lt 2 -or $maxMemoryGiB -lt 32) {
        throw "MiniMax-H3 Base is too large for this host by the official SGLang recipes. Detected $($gpus.Count) GPU(s), max VRAM ${maxMemoryGiB}GiB. Use -Force only on a machine where you intentionally accept an unsupported run."
    }
}

$sglang = Get-Command sglang.exe -ErrorAction SilentlyContinue
if (-not $sglang) {
    $sglang = Get-Command sglang -ErrorAction SilentlyContinue
}
if (-not $sglang) {
    throw 'SGLang was not found. Official install command: uv pip install "sglang[diffusion]" --prerelease=allow'
}

$env:SGLANG_USE_MODELSCOPE = "true"
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""
$env:NO_PROXY = "127.0.0.1,localhost"

& $sglang.Source serve `
    --model-path MiniMax/MiniMax-H3 `
    --model-variant $Variant `
    --num-gpus $NumGpus `
    --ulysses-degree $UlyssesDegree `
    --performance-mode speed `
    --host 127.0.0.1 `
    --port $Port

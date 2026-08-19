[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern("^v?\d+\.\d+\.\d+$")]
  [string]$Version,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$CommitMessage,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$ReleaseTitle,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$ReleaseNotes
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$git = (Get-Command git.exe -ErrorAction Stop).Source
$gh = Join-Path (Split-Path -Parent $projectRoot) "tools\github-cli\gh_2.97.0_windows_amd64\bin\gh.exe"

if (-not (Test-Path $gh)) {
  throw "Authorized GitHub CLI not found: $gh"
}

$tag = if ($Version.StartsWith("v")) { $Version } else { "v$Version" }
$savedEnvironment = @{}
$temporaryNames = @(
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
  "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY", "GIT_TERMINAL_PROMPT", "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1",
  "GIT_CONFIG_KEY_2", "GIT_CONFIG_VALUE_2", "GH_CONFIG_DIR"
)

try {
  foreach ($name in $temporaryNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
  }

  $env:GH_CONFIG_DIR = Join-Path $projectRoot ".runtime\gh-config"
  $token = (& $gh auth token).Trim()
  if (-not $token) {
    throw "Unable to read GitHub authorization."
  }

  foreach ($name in $temporaryNames | Where-Object { $_ -match "proxy" }) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }

  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x-access-token:$token"))
  $env:GIT_TERMINAL_PROMPT = "0"
  $env:GIT_CONFIG_COUNT = "3"
  $env:GIT_CONFIG_KEY_0 = "credential.helper"
  $env:GIT_CONFIG_VALUE_0 = ""
  $env:GIT_CONFIG_KEY_1 = "credential.https://github.com.helper"
  $env:GIT_CONFIG_VALUE_1 = ""
  $env:GIT_CONFIG_KEY_2 = "http.extraHeader"
  $env:GIT_CONFIG_VALUE_2 = "Authorization: Basic $basic"

  & $git -C $projectRoot add -A
  if ($LASTEXITCODE -ne 0) { throw "Unable to stage release files." }
  & $git -C $projectRoot diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { throw "No changes are ready for release." }

  & $git -C $projectRoot commit -m $CommitMessage
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the release commit." }
  & $git -C $projectRoot tag -a $tag -m $tag
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the release tag." }
  & $git -C $projectRoot -c http.sslBackend=openssl -c http.version=HTTP/1.1 push origin main --follow-tags
  if ($LASTEXITCODE -ne 0) { throw "Unable to push to GitHub." }
  & $gh release create $tag --repo lhan64680-hue/wxhb --title $ReleaseTitle --notes $ReleaseNotes
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the GitHub Release." }
} finally {
  foreach ($name in $temporaryNames) {
    if ($null -eq $savedEnvironment[$name]) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$name" $savedEnvironment[$name]
    }
  }
  Remove-Variable token, basic -ErrorAction SilentlyContinue
}

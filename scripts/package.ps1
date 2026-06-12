param(
  [string]$Output = "dist/video-theater.zip"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$Destination = Join-Path $Root $Output

New-Item -ItemType Directory -Force -Path $Dist | Out-Null
if (Test-Path $Destination) {
  Remove-Item $Destination
}

$PackageItems = @(
  "manifest.json",
  "src",
  "popup",
  "options",
  "icons",
  "_locales"
)

$Paths = $PackageItems | ForEach-Object { Join-Path $Root $_ }
Compress-Archive -Path $Paths -DestinationPath $Destination -Force
Write-Host "Created $Destination"

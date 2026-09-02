# Publish the version declared in package.json, including checksum metadata
# required by the in-app updater.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upload-release.ps1
# Requires network access to github.com (check your Clash node if TLS times out).
$ErrorActionPreference = 'Stop'
$repo = 'zamatewi-cell/traesolocn_account_manager'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$tag = "v$version"
$releaseDir = Join-Path $root 'release'
$assets = @(
  (Join-Path $releaseDir "Trae-Account-Manager-Setup-$version.exe"),
  (Join-Path $releaseDir "Trae-Account-Manager-Setup-$version.exe.blockmap"),
  (Join-Path $releaseDir 'latest.yml')
)

foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset)) {
    throw "Missing release asset: $asset. Run npm run dist first."
  }
}

$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
gh release view $tag --repo $repo *> $null
$releaseExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousErrorAction

if (-not $releaseExists) {
  Write-Host "Creating draft release $tag..."
  gh release create $tag --repo $repo --title $tag --draft --generate-notes
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create draft release.' }
}

Write-Host "Uploading release assets for $tag..."
gh release upload $tag @assets --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { throw 'Upload failed - check network / Clash node, then rerun this script.' }

Write-Host 'Publishing release (draft -> latest)...'
gh release edit $tag --repo $repo --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Publish failed - asset uploaded, rerun only the edit command below.' }

Write-Host "DONE: https://github.com/$repo/releases/tag/$tag"

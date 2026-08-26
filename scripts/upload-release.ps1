# Publish release v1.1.0: upload installer asset and publish the draft release.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upload-release.ps1
# Requires network access to github.com (check your Clash node if TLS times out).
$ErrorActionPreference = 'Stop'
$repo = 'zamatewi-cell/traesolocn_account_manager'
$exe = Join-Path $PSScriptRoot '..\release\Trae-Account-Manager-Setup-1.1.0.exe'

Write-Host 'Uploading installer asset...'
gh release upload v1.1.0 $exe --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { throw 'Upload failed - check network / Clash node, then rerun this script.' }

Write-Host 'Publishing release (draft -> latest)...'
gh release edit v1.1.0 --repo $repo --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Publish failed - asset uploaded, rerun only the edit command below.' }

Write-Host 'DONE: https://github.com/zamatewi-cell/traesolocn_account_manager/releases/tag/v1.1.0'

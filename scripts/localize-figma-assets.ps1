param(
  [Parameter(Mandatory=$true)]
  [string]$InputFile,
  [string]$RepoRoot = (Resolve-Path '.').Path,
  [string]$AssetsDir = 'src/renderer/assets/figma',
  [switch]$DryRun
)

function Get-ExtensionFromContentType([string]$contentType) {
  if (!$contentType) { return '.png' }
  if ($contentType -match 'image/svg\+xml') { return '.svg' }
  if ($contentType -match 'image/png') { return '.png' }
  if ($contentType -match 'image/jpeg') { return '.jpg' }
  if ($contentType -match 'image/webp') { return '.webp' }
  return '.png'
}

if (!(Test-Path $InputFile)) {
  Write-Error "InputFile not found: $InputFile"
  exit 1
}

$assetsPath = Join-Path $RepoRoot $AssetsDir
if (-not (Test-Path $assetsPath)) {
  New-Item -ItemType Directory -Force -Path $assetsPath | Out-Null
}

$lines = Get-Content $InputFile | Where-Object { $_ -and $_.Trim().Length -gt 0 -and -not $_.Trim().StartsWith('#') }
if ($lines.Count -eq 0) {
  Write-Error "No URLs found in $InputFile"
  exit 1
}

$mapping = @{}
$index = 1
foreach ($line in $lines) {
  $parts = $line -split '\s+'
  $url = $parts[0]
  $name = $null
  if ($parts.Length -ge 2) {
    $name = $parts[1]
  }
  if (-not $name) {
    $name = "asset-$index.png"
  }

  $targetPath = Join-Path $assetsPath $name
  if ($DryRun) {
    Write-Host "[DryRun] Download $url -> $targetPath"
  } else {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing
    $ext = [System.IO.Path]::GetExtension($name)
    if (-not $ext) {
      $ext = Get-ExtensionFromContentType $response.Headers['Content-Type']
      $targetPath = "$targetPath$ext"
      $name = "$name$ext"
    }
    $response.Content | Set-Content -Path $targetPath -Encoding Byte
  }

  $mapping[$url] = "./assets/figma/$name"
  $index += 1
}

$patterns = @('*.ts','*.tsx','*.js','*.jsx','*.css','*.html')
$files = Get-ChildItem -Path $RepoRoot -Recurse -Include $patterns | Where-Object { -not $_.FullName.Contains('node_modules') -and -not $_.FullName.Contains('dist') }

foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  $updated = $content
  foreach ($key in $mapping.Keys) {
    $updated = $updated.Replace($key, $mapping[$key])
  }
  if ($updated -ne $content) {
    if ($DryRun) {
      Write-Host "[DryRun] Update references in $($file.FullName)"
    } else {
      Set-Content -Path $file.FullName -Value $updated -Encoding UTF8
    }
  }
}

Write-Host "Done. Downloaded assets to $assetsPath and updated references."

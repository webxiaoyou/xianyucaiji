param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

# 路径准备
$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot "dist"
$releaseRoot = Join-Path $projectRoot "release"

# 读取 manifest 获取名称与版本
$manifestPath = Join-Path $projectRoot "manifest.json"
if (!(Test-Path $manifestPath)) {
  throw "manifest.json 不存在：$manifestPath"
}
$manifestJson = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = $manifestJson.version }
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = "0.0.0" }
$extName = $manifestJson.name
if ([string]::IsNullOrWhiteSpace($extName)) { $extName = "extension" }

# 清理输出目录
if (Test-Path $distRoot) { Remove-Item -Recurse -Force $distRoot }
if (Test-Path $releaseRoot) { Remove-Item -Recurse -Force $releaseRoot }
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$targets = @("chrome","edge","firefox")

function Copy-FilesToTarget([string]$targetDir) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

  $includeFiles = @(
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "styles.css",
    "index.html",
    "privacy.html",
    "xlsx-lite.js",
    "icon.svg",
    "README.md"
  )

  foreach ($f in $includeFiles) {
    $src = Join-Path $projectRoot $f
    if (Test-Path $src) {
      Copy-Item $src -Destination $targetDir -Recurse -Force
    }
  }

  $iconsSrc = Join-Path $projectRoot "icons"
  if (Test-Path $iconsSrc) {
    Copy-Item $iconsSrc -Destination $targetDir -Recurse -Force
  }
}

foreach ($t in $targets) {
  $outDir = Join-Path $distRoot $t
  Copy-FilesToTarget $outDir

  if ($t -eq "firefox") {
    $ffManifestPath = Join-Path $outDir "manifest.json"
    $ffManifest = Get-Content -Raw -Encoding UTF8 $ffManifestPath | ConvertFrom-Json

    # Firefox 专属设置（MV3 支持）：添加 browser_specific_settings
    if (-not $ffManifest.browser_specific_settings) {
      $ffManifest | Add-Member -MemberType NoteProperty -Name "browser_specific_settings" -Value (@{})
    }
    if (-not $ffManifest.browser_specific_settings.gecko) {
      $ffManifest.browser_specific_settings | Add-Member -MemberType NoteProperty -Name "gecko" -Value (@{})
    }
    if (-not $ffManifest.browser_specific_settings.gecko.id) {
      # 请按需修改成你的 AMO 扩展 ID
      $ffManifest.browser_specific_settings.gecko | Add-Member -MemberType NoteProperty -Name "id" -Value "xianyucollector@example.com"
    }
    if (-not $ffManifest.browser_specific_settings.gecko.strict_min_version) {
      $ffManifest.browser_specific_settings.gecko | Add-Member -MemberType NoteProperty -Name "strict_min_version" -Value "109.0"
    }

    # 可选兼容处理：将 host_permissions 合并到 permissions 中，提升 Firefox 兼容性
    if ($ffManifest.host_permissions) {
      if (-not $ffManifest.permissions) { $ffManifest.permissions = @() }
      foreach ($hp in $ffManifest.host_permissions) {
        if ($ffManifest.permissions -notcontains $hp) { $ffManifest.permissions += $hp }
      }
    }

    $ffJson = $ffManifest | ConvertTo-Json -Depth 64
    Set-Content -Path $ffManifestPath -Value $ffJson -Encoding UTF8
  }

  # 生成 zip 包
  $zipName = "{0}-{1}-{2}.zip" -f $extName,$Version,$t
  $zipPath = Join-Path $releaseRoot $zipName
  Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -Force
}

Write-Host "打包完成。产物位置：$releaseRoot"
Get-ChildItem $releaseRoot -File | ForEach-Object { Write-Host (" - " + $_.Name) }
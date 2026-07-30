# build.ps1 - Build the one-click installer for mrvideo_s (course edition).
# Pipeline: zip site files (index.html/manual.html/css/js, no Code.gs or setup guide)
#           -> embed zip into Installer.cs -> compile with built-in .NET Framework csc.exe
#           -> installer exe output in this folder.
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
# NOTE: keep this file ASCII-only (PS 5.1 reads BOM-less files as ANSI).

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent   # mrvideo_s/

# 1. Stage site files (student-facing only; Code.gs / setup guide are teacher-only, excluded)
$stage = Join-Path $env:TEMP 've-s-installer-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $root 'index.html') $stage
Copy-Item (Join-Path $root 'manual.html') $stage
Copy-Item (Join-Path $root 'css') (Join-Path $stage 'css') -Recurse
Copy-Item (Join-Path $root 'js') (Join-Path $stage 'js') -Recurse

# 2. Zip
$zip = Join-Path $env:TEMP 've-s-app.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip

# 3. Compile installer with embedded zip (output beside this script)
$dist = $PSScriptRoot
# CJK output filename built from code points (file must stay ASCII-only) ->
# "influence" chars spell "YingPianXianSheng" (video editor name) + "KeChengJiaoXueBan" (course edition) + "AnZhuangChengShi" (installer)
$outName = [char]0x5F71 + [char]0x7247 + [char]0x5148 + [char]0x751F +
           [char]0x8AB2 + [char]0x7A0B + [char]0x6559 + [char]0x5B78 + [char]0x7248 +
           [char]0x5B89 + [char]0x88DD + [char]0x7A0B + [char]0x5F0F
$out = Join-Path $dist ($outName + '.exe')
if (Test-Path $out) { Remove-Item $out -Force }
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }

& $csc /nologo /codepage:65001 /target:winexe `
  /out:$out `
  /resource:"$zip,app.zip" `
  /r:System.IO.Compression.dll /r:System.Windows.Forms.dll `
  (Join-Path $PSScriptRoot 'Installer.cs')
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

$size = [math]::Round((Get-Item $out).Length / 1KB)
Write-Output "OK: $out ($size KB)"

@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 exit /b 1
set "BAMBI_BUILD_ROOT=%CD%"
rem Build tools remain local to the source tree. Tester machines do not run this.
rem This uses ordinary inbox PowerShell commands without changing execution policy.
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; if($env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw 'Use native Windows x64'}; $root=$env:BAMBI_BUILD_ROOT; $pin=(Get-Content -LiteralPath (Join-Path $root 'config/desktop-windows-runtime.json') -Raw | ConvertFrom-Json).node; $cache=Join-Path $root '.runtime/desktop-windows-downloads'; New-Item -ItemType Directory -Force -Path $cache | Out-Null; $zip=Join-Path $cache $pin.file; if(!(Test-Path -LiteralPath $zip)){ $partial=$zip+'.bootstrap-partial'; try { Invoke-WebRequest -UseBasicParsing -Uri $pin.url -OutFile $partial; if((Get-Item -LiteralPath $partial).Length -ne $pin.bytes -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256){throw 'Pinned Node archive mismatch'}; Move-Item -LiteralPath $partial -Destination $zip } finally { if(Test-Path -LiteralPath $partial){Remove-Item -LiteralPath $partial} } }; if((Get-Item -LiteralPath $zip).Length -ne $pin.bytes -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256){throw 'Pinned Node archive mismatch'}; $tools=Join-Path $root '.runtime/desktop-windows-tools'; Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force"
if errorlevel 1 goto failed
set "BAMBI_BUILD_NODE=%CD%\.runtime\desktop-windows-tools\node-v24.18.1-win-x64"
set "PATH=%BAMBI_BUILD_NODE%;%PATH%"
set "ELECTRON_SKIP_BINARY_DOWNLOAD=1"
"%BAMBI_BUILD_NODE%\node.exe" "%BAMBI_BUILD_NODE%\node_modules\npm\bin\npm-cli.js" ci --ignore-scripts
if errorlevel 1 goto failed
"%BAMBI_BUILD_NODE%\node.exe" scripts\desktop-windows-build.mjs %*
if errorlevel 1 goto failed
popd
exit /b 0
:failed
popd
exit /b 1

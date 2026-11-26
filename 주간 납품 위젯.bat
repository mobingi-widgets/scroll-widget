@echo off
rem Weekly delivery widget (read-only overlay). Keep this file ASCII: cmd reads it in the system code page.
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 goto nopython
if exist "node_modules\electron\dist\electron.exe" goto run
echo First run: installing Electron...
call npm install --no-audit --no-fund
if errorlevel 1 goto noelectron
call node node_modules\electron\install.js
if not exist "node_modules\electron\dist\electron.exe" goto noelectron
:run
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
:nopython
echo Python 3.10+ is required (python.org, check "Add python.exe to PATH").
pause
exit /b 1
:noelectron
echo Electron install failed. Check that Node.js and npm are installed.
pause
exit /b 1

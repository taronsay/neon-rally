@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 20 or newer, then run this file again.
 pause
 exit /b 1
)
if not exist "node_modules\ws\package.json" goto INSTALL
if not exist "node_modules\three\package.json" goto INSTALL
goto RUN
:INSTALL
call npm install --no-audit --no-fund
if errorlevel 1 (
 echo Dependency installation failed. Check your Internet connection.
 pause
 exit /b 1
)
:RUN
call npm start
pause

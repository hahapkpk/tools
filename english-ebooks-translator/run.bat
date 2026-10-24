@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
python -m automation.local_setup
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%

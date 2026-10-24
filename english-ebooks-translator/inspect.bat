@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
set "BOOK=%~1"
if not defined BOOK set /p "BOOK=EPUB path (no surrounding quotes): "
if not defined BOOK exit /b 1
python -m ebook_translator inspect --input "%BOOK%"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%

@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: start_server.bat  –  Launch the Vocabulary Trainer web server
:: Double-click this file to start the app, then open http://localhost:5000
:: ─────────────────────────────────────────────────────────────────────────────

echo.
echo ==========================================
echo  Vocabulary Trainer – Starting Server
echo ==========================================
echo.

:: Move to the folder that contains this bat file (handles running from anywhere)
cd /d "%~dp0"

:: Try several ways to call Python
set PYTHON=

where python >nul 2>nul
if %errorlevel%==0 ( set PYTHON=python & goto :found )

where python3 >nul 2>nul
if %errorlevel%==0 ( set PYTHON=python3 & goto :found )

where py >nul 2>nul
if %errorlevel%==0 ( set PYTHON=py & goto :found )

if exist "%USERPROFILE%\anaconda3\python.exe" (
    set PYTHON=%USERPROFILE%\anaconda3\python.exe & goto :found )

if exist "%USERPROFILE%\miniconda3\python.exe" (
    set PYTHON=%USERPROFILE%\miniconda3\python.exe & goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python310\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python310\python.exe
    goto :found )

echo [ERROR] Python was not found. Please run setup.bat first.
pause
exit /b 1

:found
echo Using Python: %PYTHON%
echo.
echo Server starting at http://localhost:5000
echo (The PDF will import automatically on first visit — no extra step needed)
echo.
echo Press Ctrl+C in this window to stop the server.
echo.
%PYTHON% app.py
pause

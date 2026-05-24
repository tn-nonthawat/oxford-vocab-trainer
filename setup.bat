@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: setup.bat  –  Install Python packages for the Vocabulary Trainer
::
:: Only two packages are required:
::   flask  – lightweight web server
::   pypdf  – pure-Python PDF reader (no C compilation, works on Python 3.15)
::
:: Double-click this file once to set up all dependencies.
:: ─────────────────────────────────────────────────────────────────────────────

echo.
echo ==========================================
echo  Vocabulary Trainer – Dependency Setup
echo ==========================================
echo.

set PYTHON=

where python >nul 2>nul
if %errorlevel%==0 ( set PYTHON=python & goto :found )

where python3 >nul 2>nul
if %errorlevel%==0 ( set PYTHON=python3 & goto :found )

where py >nul 2>nul
if %errorlevel%==0 ( set PYTHON=py & goto :found )

:: Common Python install locations (newest first)
if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python315\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python315\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python314\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python314\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python313\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python313\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python311\python.exe
    goto :found )

if exist "%USERPROFILE%\AppData\Local\Programs\Python\Python310\python.exe" (
    set PYTHON=%USERPROFILE%\AppData\Local\Programs\Python\Python310\python.exe
    goto :found )

:: Anaconda / Miniconda
if exist "%USERPROFILE%\anaconda3\python.exe" (
    set PYTHON=%USERPROFILE%\anaconda3\python.exe & goto :found )

if exist "%USERPROFILE%\miniconda3\python.exe" (
    set PYTHON=%USERPROFILE%\miniconda3\python.exe & goto :found )

echo [ERROR] Python was not found on this computer.
echo.
echo Please install Python from https://www.python.org/downloads/
echo Make sure to check "Add Python to PATH" during installation.
echo.
pause
exit /b 1

:found
echo Python found: %PYTHON%
echo.

echo Installing required packages (flask, pypdf, pdfplumber) ...
echo.
echo NOTE: If you are running Python 3.15, pdfplumber may fail to install
echo because Pillow has no pre-built wheel for 3.15 yet.  In that case,
echo run setup.bat again with Python 3.13 or 3.14 instead.
echo.
%PYTHON% -m pip install --upgrade pip
%PYTHON% -m pip install flask pypdf pdfplumber

echo.
if %errorlevel%==0 (
    echo ==========================================
    echo  SUCCESS!  All packages installed.
    echo.
    echo  Next steps:
    echo    1. Double-click start_server.bat
    echo    2. Open http://localhost:5000 in your browser
    echo    3. Click "Import PDF Word List" on the dashboard
    echo ==========================================
) else (
    echo ==========================================
    echo  Something went wrong. See errors above.
    echo ==========================================
)
echo.
pause

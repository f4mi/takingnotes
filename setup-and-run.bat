@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ==========================================
echo   TakingNotes Ink - Setup and Run
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo.
  echo Please install Node.js 20+ from: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v" %%a in ('node -v') do set NODE_VERSION=%%a
for /f "tokens=1 delims=." %%a in ("%NODE_VERSION%") do set NODE_MAJOR=%%a

if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js version %NODE_VERSION% is too old.
  echo This project requires Node.js 20 or newer.
  echo.
  echo Please upgrade from: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo [OK] Node.js %NODE_VERSION% found
echo.

if not exist "node_modules" (
  echo [INFO] First run detected. Installing dependencies...
  echo This may take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
  echo [OK] Dependencies installed successfully!
  echo.
) else (
  echo [OK] Dependencies already installed
  echo.
)

:menu
echo ==========================================
echo   What would you like to do?
echo ==========================================
echo.
echo   1) Start development server
echo   2) Build for production
echo   3) Preview production build
echo   4) Clean (remove node_modules and dist)
echo   5) Exit
echo.
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto build
if "%choice%"=="3" goto preview
if "%choice%"=="4" goto clean
if "%choice%"=="5" goto end

echo Invalid choice. Try again.
echo.
goto menu

:dev
echo.
echo [INFO] Starting development server...
echo [INFO] Opening browser at http://localhost:3000
echo [INFO] Press Ctrl+C to stop
echo.
timeout /t 2 >nul
start "" http://localhost:3000
node scripts\run.mjs dev
if errorlevel 1 (
  echo.
  echo [ERROR] Dev server failed.
  pause
)
goto menu

:build
echo.
echo [INFO] Building for production...
echo.
node scripts\run.mjs build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed.
  pause
) else (
  echo.
  echo [OK] Build complete! Output is in the 'dist' folder.
  pause
)
goto menu

:preview
echo.
echo [INFO] Starting preview server...
echo [INFO] Opening browser at http://localhost:4173
echo [INFO] Press Ctrl+C to stop
echo.
timeout /t 2 >nul
start "" http://localhost:4173
node scripts\run.mjs preview
if errorlevel 1 (
  echo.
  echo [ERROR] Preview server failed.
  pause
)
goto menu

:clean
echo.
echo [INFO] Cleaning project...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "dist" rmdir /s /q "dist"
echo [OK] Clean complete!
echo.
pause
goto menu

:end
echo.
echo Goodbye!
timeout /t 1 >nul
exit /b 0

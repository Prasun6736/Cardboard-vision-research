@echo off
setlocal

echo Creating the Visual Field HTTPS certificate using shared\config.ts...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-local-cert.ps1"

if errorlevel 1 (
  echo.
  echo Certificate creation failed.
  pause
  exit /b 1
)

echo.
echo Certificate creation completed.
echo The certificate was created and trusted. Next run: npm run dev
pause

@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-infinite-canvas.ps1"
if errorlevel 1 pause

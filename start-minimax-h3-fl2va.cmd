@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-minimax-h3.ps1" -Variant fl2va -Port 30010
if errorlevel 1 pause

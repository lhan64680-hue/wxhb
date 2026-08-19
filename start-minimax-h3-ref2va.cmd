@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-minimax-h3.ps1" -Variant ref2va -Port 30011
if errorlevel 1 pause

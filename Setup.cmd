@echo off
rem CrowderSphere Setup - opens the installer window
start "" "%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0app\setup.ps1"

@echo off
setlocal
if not exist "%~dp0Start.ps1" goto incomplete
if not exist "%~dp0Window.ps1" goto incomplete
if not exist "%~dp0Worker.ps1" goto incomplete
if not exist "%~dp0Runtime.cs" goto incomplete
if not exist "%~dp0Plan.ps1" goto incomplete
if not exist "%~dp0helper.json" goto incomplete
cd /d "%~dp0"
start "" powershell.exe -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0Start.ps1"
exit /b 0

:incomplete
echo BTS-Sprachhelfer: Das Starter-Paket ist nicht vollstaendig entpackt.
echo.
echo Bitte die ZIP-Datei mit der rechten Maustaste anklicken
echo und "Alle extrahieren..." waehlen.
echo Danach Start.cmd im entpackten Ordner oeffnen.
echo.
echo Alle Dateien aus der ZIP muessen im selben Ordner liegen.
pause
exit /b 1

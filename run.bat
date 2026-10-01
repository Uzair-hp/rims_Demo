@echo off
REM Ruchita Interiors - double-clickable launcher.
REM Runs run.ps1 (setup check + start dev servers), bypassing the PS execution policy.
REM Any arguments are passed through, e.g.  run.bat -Detached  |  run.bat -Stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
pause

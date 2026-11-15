@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:8188
venv\Scripts\python.exe main.py --windows-standalone-build
pause

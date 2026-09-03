@echo off
REM %~dp0 is this file's own folder; '..' is the repo. Hardcoding the repo path
REM is what left three scheduled tasks pointing at a folder that moved on 08-27.
cd /d "%~dp0.."
node scripts\reddit-scout.mjs >> scripts\reddit-scout.log 2>&1

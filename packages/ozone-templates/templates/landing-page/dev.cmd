@echo off
rem Runs a command inside the app container, where Node and the dependencies live.
rem
rem   dev npm run typecheck
rem   dev npm install zod
rem
rem The Windows twin of ./dev: cmd and PowerShell cannot run a script that has no extension.
rem Uses the running app service when there is one. Otherwise it starts a throwaway container;
rem that container does not start the database, so commands that need it require the app to
rem be running.
setlocal
cd /d "%~dp0"

if "%~1"=="" echo Usage: dev ^<command^> [args...] 1>&2
if "%~1"=="" exit /b 64

set "OZONE_DEV_MODE=run --rm --no-deps -T"
for /f "delims=" %%i in ('docker compose ps --quiet --status running app 2^>nul') do set "OZONE_DEV_MODE=exec -T"

docker compose %OZONE_DEV_MODE% app %*
exit /b %errorlevel%

@echo off
rem Powder Seeker - Windows double-click version of scripts/run-local-model.sh.
rem
rem Double-click this file. It will:
rem   1. Install Git and Node.js (LTS) with winget if they're missing.
rem   2. Use the repo this file sits in, or download it to %USERPROFILE%\stormchaser.
rem   3. Install the project's npm packages.
rem   4. Ask once for SUPABASE_SERVICE_ROLE_KEY (typing is hidden) and save it
rem      to .env.local, which git ignores. The key never leaves this computer.
rem   5. Ask which run you want, then download the history and run the backtests.
rem
rem Open-Meteo's free tier allows about 10,000 calls a day. The full 40-year run
rem needs about 50,000, so it stops once a day. Double-click again the next day
rem and pick option 2; it carries on from local-data\progress.json.

setlocal EnableExtensions DisableDelayedExpansion
title Powder Seeker - local model run

set "REPO_URL=https://github.com/bigskicoder/stormchaser.git"
set "REPO_BRANCH=claude/autonomous-coding-5hk5wt"
set "SUPABASE_URL_DEFAULT=https://hfvcwrzjekzrpyerefao.supabase.co"

rem --- 1. Git and Node.js -----------------------------------------------------
where winget >nul 2>&1
if errorlevel 1 (
  set "NO_WINGET=1"
)

where git >nul 2>&1
if errorlevel 1 (
  if defined NO_WINGET goto :need_manual_git
  echo.
  echo ==^> Installing Git. Click Yes if Windows asks for permission.
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
)
where git >nul 2>&1
if errorlevel 1 goto :need_manual_git

set "NODE_MAJOR=0"
where node >nul 2>&1
if not errorlevel 1 (
  for /f "usebackq delims=" %%v in (`node -p "process.versions.node.split('.')[0]"`) do set "NODE_MAJOR=%%v"
)
if %NODE_MAJOR% LSS 20 (
  if defined NO_WINGET goto :need_manual_node
  echo.
  echo ==^> Installing Node.js. Click Yes if Windows asks for permission.
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 goto :need_manual_node
for /f "usebackq delims=" %%v in (`node --version`) do echo Node %%v

rem --- 2. Find (or download) the repo -----------------------------------------
if exist "%~dp0..\scripts\run-local-model.ts" (
  cd /d "%~dp0.."
  goto :have_repo
)
if exist "%~dp0scripts\run-local-model.ts" (
  cd /d "%~dp0"
  goto :have_repo
)
if exist "%USERPROFILE%\stormchaser\package.json" (
  cd /d "%USERPROFILE%\stormchaser"
  echo.
  echo ==^> Updating the code in %USERPROFILE%\stormchaser
  git pull --ff-only
  goto :have_repo
)
echo.
echo ==^> Downloading the code to %USERPROFILE%\stormchaser
echo     If a GitHub sign-in window opens, sign in as usual.
git clone --branch "%REPO_BRANCH%" "%REPO_URL%" "%USERPROFILE%\stormchaser"
if errorlevel 1 goto :fail
cd /d "%USERPROFILE%\stormchaser"
:have_repo
echo Working in %CD%

rem --- 3. npm packages --------------------------------------------------------
echo.
echo ==^> Installing npm packages (the first time takes a few minutes)
call npm ci --no-audit --no-fund
if errorlevel 1 goto :fail

rem --- 4. Environment ---------------------------------------------------------
if not exist ".env.local" type nul > ".env.local"

findstr /b /c:"NEXT_PUBLIC_SUPABASE_URL=" ".env.local" >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "[IO.File]::AppendAllText('.env.local', [Environment]::NewLine + 'NEXT_PUBLIC_SUPABASE_URL=%SUPABASE_URL_DEFAULT%' + [Environment]::NewLine)"
)

findstr /b /c:"SUPABASE_SERVICE_ROLE_KEY=" ".env.local" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ==^> Supabase service-role key needed
  echo     Get it from the Supabase dashboard: Project Settings, API keys, service_role secret.
  echo     Paste it below and press Enter. Nothing shows while you paste; that's normal.
  echo     It's saved only in .env.local on this computer.
  rem PowerShell reads and writes the key itself so it never passes through this window's variables.
  powershell -NoProfile -Command "$s = Read-Host 'SUPABASE_SERVICE_ROLE_KEY' -AsSecureString; $k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim(); if (-not $k) { exit 1 }; [IO.File]::AppendAllText('.env.local', [Environment]::NewLine + 'SUPABASE_SERVICE_ROLE_KEY=' + $k + [Environment]::NewLine)"
  if errorlevel 1 (
    echo No key entered.
    goto :fail
  )
)

rem Load .env.local into this window (lines starting with # are skipped).
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env.local") do set "%%a=%%b"

rem --- 5. Pick a run and go ---------------------------------------------------
echo.
echo What do you want to run?
echo   1 = First run: link resorts to SNOTEL stations, then a quick 1-year check. Start here.
echo   2 = Full 40-year history, or carry on where the last run stopped.
choice /c 12 /n /m "Type 1 or 2: "
if errorlevel 2 (
  set "RUN_ARGS="
  set "DO_SEED=0"
  if not exist "local-data\progress.json" set "DO_SEED=1"
) else (
  set "RUN_ARGS=--skip-forecast --years=1"
  set "DO_SEED=1"
)

if "%DO_SEED%"=="1" (
  echo.
  echo ==^> Resolving resort elevations, SNOTEL stations and NWS gridpoints
  call npm run --silent seed:resorts
  if errorlevel 1 goto :fail
)

echo.
echo ==^> Downloading history and running the backtests
call npx tsx scripts/run-local-model.ts %RUN_ARGS%
set "STATUS=%ERRORLEVEL%"
echo.
if "%STATUS%"=="0" (
  echo Done. Results are in %CD%\local-data
) else if "%STATUS%"=="2" (
  echo Stopped at today's Open-Meteo limit. Double-click this file again tomorrow and pick 2 to continue.
) else (
  goto :fail
)
pause
exit /b %STATUS%

:need_manual_git
echo.
echo Git isn't installed and couldn't be installed automatically.
echo Install it from https://git-scm.com/download/win, then double-click this file again.
pause
exit /b 1

:need_manual_node
echo.
echo Node.js 20 or newer isn't installed and couldn't be installed automatically.
echo Install the LTS version from https://nodejs.org, then double-click this file again.
pause
exit /b 1

:fail
echo.
echo Something went wrong. Scroll up to see the error, or copy this window's text into the project chat.
pause
exit /b 1

#!/usr/bin/env bash
# Powder Seeker — one-shot local setup + historical backtest ("download the
# data and compute the model"). macOS or Linux (on Windows, run it in WSL).
#
#   ./scripts/run-local-model.sh                    # 40 yrs SLR + 5 yrs forecast archive
#   ./scripts/run-local-model.sh --years=10         # shorter SLR history
#   ./scripts/run-local-model.sh --resort=alta      # one resort only
#   ./scripts/run-local-model.sh --skip-seed        # skip resort onboarding lookups
#   ./scripts/run-local-model.sh --version=<id>     # backtest a draft model version
#
# What it does, in order:
#   1. Installs Node.js 24 if you don't have Node >= 20 (Homebrew on macOS
#      if present, otherwise nvm), then the project's npm packages. No
#      Python or local database is needed: the app is TypeScript and the
#      database is the hosted Supabase Postgres.
#   2. Asks once for SUPABASE_SERVICE_ROLE_KEY (hidden input) and saves it
#      to .env.local, which git ignores.
#   3. Runs `npm run seed:resorts`: elevation check, nearest SNOTEL station,
#      NWS gridpoint per resort. Safe to re-run.
#   4. Runs scripts/run-local-model.ts: downloads history from Open-Meteo
#      and NRCS SNOTEL in 1-year chunks, computes backtest accuracy, writes
#      it to Supabase, generates calibration recommendations, and saves CSV
#      copies under local-data/.
#
# Open-Meteo's free tier allows ~10,000 calls/day, and the full 40-year run
# needs roughly 50k, so expect it to stop once a day with exit code 2. Just
# run it again the next day; it resumes from local-data/progress.json.

set -euo pipefail

REPO_URL="https://github.com/bigskicoder/stormchaser.git"
REPO_BRANCH="claude/autonomous-coding-5hk5wt"
NVM_VERSION="v0.40.3"
NODE_MAJOR="24"
SUPABASE_URL_DEFAULT="https://hfvcwrzjekzrpyerefao.supabase.co"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

SKIP_SEED=0
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --skip-seed) SKIP_SEED=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

# --- 0. Find (or fetch) the repo -------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../package.json" ]] && grep -q '"seed:resorts"' "$SCRIPT_DIR/../package.json"; then
  cd "$SCRIPT_DIR/.."
else
  command -v git >/dev/null || die "git is required (macOS: run 'xcode-select --install')."
  say "Cloning the repository into ./stormchaser"
  [[ -d stormchaser ]] || git clone --branch "$REPO_BRANCH" "$REPO_URL" stormchaser
  cd stormchaser
fi

# --- 1. Node.js + npm packages ---------------------------------------------
node_ok() {
  command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]]
}

if ! node_ok; then
  say "Installing Node.js $NODE_MAJOR"
  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null; then
    brew install "node@$NODE_MAJOR"
    export PATH="$(brew --prefix "node@$NODE_MAJOR")/bin:$PATH"
  else
    command -v curl >/dev/null || die "curl is required to install Node.js."
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
    fi
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install "$NODE_MAJOR"
    nvm use "$NODE_MAJOR"
  fi
  node_ok || die "Node.js install didn't take. Install Node $NODE_MAJOR from https://nodejs.org and re-run."
fi
echo "Node $(node --version), npm $(npm --version)"

say "Installing npm packages"
npm ci --no-audit --no-fund

# --- 2. Environment ---------------------------------------------------------
touch .env.local
chmod 600 .env.local
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL_DEFAULT" >> .env.local
  export NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL_DEFAULT"
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  say "Supabase service-role key needed"
  echo "Get it from Supabase dashboard > Project Settings > API keys > service_role (secret)."
  echo "It's saved only to .env.local on this machine (git-ignored)."
  read -r -s -p "Paste SUPABASE_SERVICE_ROLE_KEY: " key; echo
  [[ -n "$key" ]] || die "No key entered."
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$key" >> .env.local
  export SUPABASE_SERVICE_ROLE_KEY="$key"
  unset key
fi

# --- 3. Resort onboarding lookups ------------------------------------------
if [[ "$SKIP_SEED" -eq 0 ]]; then
  say "Resolving resort elevations, SNOTEL stations and NWS gridpoints"
  npm run --silent seed:resorts
fi

# --- 4. Download history + compute -----------------------------------------
say "Downloading history and running the backtests"
set +e
npx tsx scripts/run-local-model.ts "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
status=$?
set -e
if [[ $status -eq 2 ]]; then
  echo "Stopped at today's Open-Meteo limit. Re-run this script tomorrow to continue."
fi
exit $status

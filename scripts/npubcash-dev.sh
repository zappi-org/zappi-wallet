#!/usr/bin/env bash
# Local npubcash (4xvgal fork) + wallet dev stack.
#
#   ./scripts/npubcash-dev.sh sync        # fetch origin(main) + fork branch, report drift
#   ./scripts/npubcash-dev.sh up          # npubcash server on :8000 (testnut mint)
#   ./scripts/npubcash-dev.sh app         # vite dev on :5173 wired to :8000
#   ./scripts/npubcash-dev.sh offline     # fork redeem path only (no server, no port)
#   ./scripts/npubcash-dev.sh check       # headless E2E: token → 402 → purchase → alias
#   ./scripts/npubcash-dev.sh fund 250    # print a token to paste into the app
#   ./scripts/npubcash-dev.sh status|logs|down|reset
#
# Overrides: NPUBCASH_SERVER_DIR, NPUBCASH_BRANCH (fix/v4-keyset), MINTURL,
#            NPUBCASH_PORT, UI_PORT, USERNAME_COST, JWT_SECRET
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="${NPUBCASH_SERVER_DIR:-$HOME/doc_off/github.com/npubcash-server}"
BRANCH="${NPUBCASH_BRANCH:-fix/v4-keyset}"
RUN_DIR="$APP_DIR/.npubcash.local"          # gitignored (*.local)
MINT="${MINTURL:-https://testnut.cashu.space}"
PORT="${NPUBCASH_PORT:-8000}"
UI_PORT="${UI_PORT:-5173}"
COST="${USERNAME_COST:-100}"
URL="http://localhost:$PORT"
mkdir -p "$RUN_DIR"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

http_status() { curl -s -m 3 -o /dev/null -w '%{http_code}' -A 'npubcash-dev' "$1" || true; }

wait_http() { # url expected-code seconds
  local url=$1 want=$2 t=${3:-40}
  for _ in $(seq 1 $((t * 2))); do
    [ "$(http_status "$url")" = "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

cmd_sync() {
  say "app: fetch origin"
  git -C "$APP_DIR" fetch origin --prune
  local branch behind ahead
  branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
  read -r ahead behind < <(git -C "$APP_DIR" rev-list --left-right --count "HEAD...origin/main")
  echo "  branch: $branch   behind main: $behind   ahead: $ahead"
  if [ "$branch" = main ]; then
    git -C "$APP_DIR" pull --ff-only origin main
  elif [ "${behind:-0}" -gt 0 ]; then
    echo "  → merge when you're ready: git merge origin/main   (or: git rebase origin/main)"
  fi

  say "npubcash: fetch fork"
  git -C "$SERVER_DIR" fetch fork --prune
  local dirty
  dirty="$(git -C "$SERVER_DIR" status --porcelain | grep -v '^?? ' || true)"
  [ -n "$dirty" ] && { echo "  ! working tree dirty — pull may conflict:"; echo "$dirty" | sed 's/^/    /'; }
  read -r ahead behind < <(git -C "$SERVER_DIR" rev-list --left-right --count "HEAD...fork/$BRANCH")
  echo "  branch: $(git -C "$SERVER_DIR" rev-parse --abbrev-ref HEAD)   behind fork/$BRANCH: $behind   ahead: $ahead"
  if [ "${behind:-0}" -gt 0 ] && [ -z "$dirty" ]; then
    git -C "$SERVER_DIR" pull --ff-only fork "$BRANCH"
  fi
  git -C "$SERVER_DIR" log --oneline -1
}

cmd_up() {
  alive "$RUN_DIR/server.pid" && { echo "server already running (pid $(cat "$RUN_DIR/server.pid"))"; return; }
  say "npubcash server ($BRANCH) → $URL  [mint $MINT, cost $COST sat]"
  # migrations run on boot; sqlite lives inside the repo-ignored run dir.
  (
    cd "$SERVER_DIR/packages/server"
    MINTURL="$MINT" \
    USERNAME_MINT="${USERNAME_MINT:-$MINT}" \
    USERNAME_COST="$COST" \
    JWT_SECRET="${JWT_SECRET:-dev-secret}" \
    DATABASE_TYPE=sqlite \
    DATABASE_URL="$RUN_DIR/npubcash.db" \
    NODE_ENV=development \
    PORT="$PORT" \
    ALLOWED_HOSTNAMES="localhost,127.0.0.1" \
    LOG_LEVEL="${LOG_LEVEL:-info}" \
    nohup bun src/index.ts >>"$RUN_DIR/server.log" 2>&1 &
    echo $! >"$RUN_DIR/server.pid"
  )
  # 401 = routes + auth middleware alive (no credentials sent)
  if wait_http "$URL/api/v2/auth/nip98" 401 40; then
    echo "  up (pid $(cat "$RUN_DIR/server.pid"))  log: $RUN_DIR/server.log"
  else
    tail -30 "$RUN_DIR/server.log" || true
    echo "  ✗ server did not come up"
    return 1
  fi
}

cmd_app() {
  alive "$RUN_DIR/app.pid" && { echo "app already running (pid $(cat "$RUN_DIR/app.pid"))"; return; }
  say "vite dev → http://localhost:$UI_PORT  (VITE_NPUBCASH_URL=$URL)"
  (
    cd "$APP_DIR"
    VITE_NPUBCASH_URL="$URL" nohup bun run dev -- --port "$UI_PORT" --strictPort \
      >>"$RUN_DIR/app.log" 2>&1 &
    echo $! >"$RUN_DIR/app.pid"
  )
  if wait_http "http://localhost:$UI_PORT" 200 60; then
    echo "  up (pid $(cat "$RUN_DIR/app.pid"))  log: $RUN_DIR/app.log"
  else
    tail -20 "$RUN_DIR/app.log" || true
    echo "  ✗ vite did not come up"
    return 1
  fi
}

cmd_check() {
  NPUBCASH_URL="$URL" MINTURL="$MINT" USERNAME_COST="$COST" \
    bun "$APP_DIR/scripts/npubcash-check.ts" "$@"
}

cmd_offline() { MINTURL="$MINT" USERNAME_COST="$COST" cmd_check --offline; }

cmd_fund() { cmd_check --fund "${1:-250}"; }

cmd_status() {
  for name in server app; do
    if alive "$RUN_DIR/$name.pid"; then
      echo "$name: running (pid $(cat "$RUN_DIR/$name.pid"))"
    else
      echo "$name: stopped"
    fi
  done
  echo "server: $(http_status "$URL/api/v2/auth/nip98")  app: $(http_status "http://localhost:$UI_PORT")"
  echo "run dir: $RUN_DIR"
}

cmd_logs() { tail -n "${2:-40}" "$RUN_DIR/${1:-server}.log"; }

cmd_down() {
  for name in app server; do
    if alive "$RUN_DIR/$name.pid"; then
      kill "$(cat "$RUN_DIR/$name.pid")" 2>/dev/null || true
      echo "$name: stopped ($(cat "$RUN_DIR/$name.pid"))"
    fi
    rm -f "$RUN_DIR/$name.pid"
  done
}

cmd_reset() {
  cmd_down
  rm -rf "$RUN_DIR/npubcash.db" "$RUN_DIR"/*.log
  echo "reset: sqlite + logs removed (next 'up' re-runs migrations)"
}

case "${1:-}" in
  sync)   cmd_sync ;;
  up)     cmd_up ;;
  app)    cmd_app ;;
  check)  shift; cmd_check "$@" ;;
  offline) cmd_offline ;;
  fund)   cmd_fund "${2:-250}" ;;
  status) cmd_status ;;
  logs)   cmd_logs "${2:-server}" "${3:-40}" ;;
  down)   cmd_down ;;
  reset)  cmd_reset ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac

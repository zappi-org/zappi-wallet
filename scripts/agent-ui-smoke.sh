#!/usr/bin/env bash
#
# agent-ui-smoke.sh — drive the wallet UI in Orca's embedded browser.
#
#   ./scripts/agent-ui-smoke.sh [baseUrl]
#
# Prereqs (this script does not start them):
#   1. `npm run dev`                     → http://localhost:5174
#   2. Orca running, this worktree active  (`orca status`)
#
# Why this is a script and not a test framework: Orca's browser automation is a stateless
# CLI, so each step is one command. It runs locally only — CI has no Orca runtime.
# Adding Playwright would mean a second, parallel automation stack; not worth it.
#
# Locators come from src/ui/lib/test-ids.ts and are read through `orca eval` — a testid is
# not part of the accessibility tree, and `orca find --locator text` silently clicks the
# wrong node when a label repeats (it did, on the bottom dock). Never match UI text here:
# every label is i18n'd.
#
# A green run is only worth something if a red one is possible: see self_check() below.
set -uo pipefail

BASE="${1:-http://localhost:5174}"
FAILED=0
SKIPPED=0

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
skip() { printf '  \033[33m—\033[0m skipped: %s\n' "$1"; SKIPPED=$((SKIPPED + 1)); }

# Sections are gated on the screens they drive. A runbook that is red on every branch that
# does not yet own a screen is worse than a partial one: people stop reading it. Skips are
# printed and counted, so "green with 3 skips" cannot be mistaken for "fully covered".
have_sel() { # <css-selector>
  local sel="${1//\"/\\\"}"
  [ "$(orca eval --expression "String(document.querySelector(\"$sel\") !== null)" 2>/dev/null)" = "true" ]
}
have() { have_sel "[data-testid=\"$1\"]"; } # <testid>

# ── preflight ────────────────────────────────────────────────────────────────
step "preflight"
# self-signed dev cert (certs/dev.pem) — `-k` is required, plain curl reports 000 here.
code=$(curl -sk -o /dev/null -w '%{http_code}' "$BASE" 2>/dev/null || echo 000)
[ "$code" = "200" ] && ok "dev server reachable ($BASE)" || { fail "dev server not answering on $BASE — run 'npm run dev'"; exit 1; }

if ! orca status >/dev/null 2>&1; then
  fail "cannot talk to the Orca runtime — start Orca, or run this outside a sandbox"
  exit 1
fi
ok "orca runtime reachable"

# ── helpers ──────────────────────────────────────────────────────────────────
# `orca eval` prints the raw value (no --json): plain stdout is what we compare, never
# the JSON envelope — its `"ok": true` matches every assertion and hides real failures.
assert_testid() { # <testid> <human label>
  local out
  out=$(orca eval --expression "String(document.querySelector('[data-testid=\"$1\"]') !== null)" 2>/dev/null)
  if [ "$out" = "true" ]; then ok "$2"; else fail "$2 (missing [data-testid=\"$1\"], got: ${out:-<no output>})"; fi
}

assert_state() { # <testid> <expected data-state>
  local out
  out=$(orca eval --expression "document.querySelector('[data-testid=\"$1\"]')?.getAttribute('data-state') ?? 'absent'" 2>/dev/null)
  if [ "$out" = "$2" ]; then ok "$1 state=$2"; else fail "$1 expected state=$2 (got: ${out:-<no output>})"; fi
}

attr_of() { # <testid> <attribute> — raw attribute value, '' when absent
  orca eval --expression "document.querySelector('[data-testid=\"$1\"]')?.getAttribute('$2') ?? ''" 2>/dev/null
}

# Negative control: an id that does not exist must read as missing. Without this, an
# assertion that is accidentally always-true reports a green app over a blank screen — that
# is exactly how the first version of this script passed twelve checks against an install
# screen. Runs once per invocation; it must NOT touch $FAILED.
self_check() {
  local out
  out=$(orca eval --expression "String(document.querySelector('[data-testid=\"__no-such-handle__\"]') !== null)" 2>/dev/null)
  if [ "$out" = "false" ]; then ok "negative control: absent handle reads as absent"
  else fail "negative control FAILED — assertions cannot detect a missing handle (got: ${out:-<no output>})"; fi
}

shot() { # <name> — orca decides where it writes; print its path.
  local out
  out=$(orca screenshot 2>/dev/null | tail -1) && ok "screenshot: $out" || true
}

# Navigation is NOT deep-linkable: stackflow `useHash` boots Home and drops `#/...` on
# load, so the script walks the same path a user does — seed, then click.
# Clicks go through `orca eval` + element.click(): `orca find --locator text` matched the
# wrong node on the tab bar and silently did nothing.
click_js() { # <js-expression-returning-element|null> <human label>
  local out
  out=$(orca eval --expression "(el => el ? (el.click(), 'clicked') : 'missing')(($1))" 2>/dev/null)
  if [ "$out" = "clicked" ]; then ok "$2"; else fail "$2 (element not found)"; fi
}

# `orca wait` returns when the document loads — the app shell mounts later (wallet unlock +
# seed). Poll the handle instead of trusting a fixed sleep.
wait_testid() { # <testid> <seconds>
  local i=0
  while [ "$i" -lt "${2:-30}" ]; do
    if [ "$(orca eval --expression "String(document.querySelector('[data-testid=\"$1\"]') !== null)" 2>/dev/null)" = "true" ]; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# ── 1. boot with the dev seed ────────────────────────────────────────────────
# `?seed=1` provisions the throwaway wallet (src/ui/lib/dev-seed.ts); `mode=standalone`
# skips the PWA install guard (src/ui/components/PWAInstallGuard.tsx isPWA()).
step "boot → ?seed=1&mode=standalone"
# Reuse the active tab instead of opening one per run — each run used to leak a tab and
# the browser session grew until the machine was under memory pressure.
orca goto --url "$BASE/?seed=1&mode=standalone" >/dev/null 2>&1
orca wait --timeout 25000 >/dev/null 2>&1
wait_testid "app-ready" 45 && ok "app shell is up and unlocked" || \
  fail "app shell never mounted — still on the lock/onboarding screen after 45s"
self_check

# ── 2. settings list ─────────────────────────────────────────────────────────
step "settings list"
click_js "document.querySelector('[data-testid=\"app-nav-tab\"][data-item-id=\"settings\"]')" \
  "dock tab → Settings"
sleep 2
assert_testid "settings-category-row" "category cards carry a stable id"

# ── 3. signer hub (owned by the signer-screen PR) ────────────────────────────
# The category card, the entry row and the screens all arrive with that PR, so each hop is
# gated independently — main runs this today and must stay green.
step "signer hub"
SKIP_SIGNER=1
LOGIN_AUTH='[data-testid="settings-category-row"][data-item-id="category-login-auth"]'
if ! have_sel "$LOGIN_AUTH"; then
  skip "category-login-auth card absent — the signer entry point is not on this branch"
else
  click_js "document.querySelector('[data-testid=\"settings-category-row\"][data-item-id=\"category-login-auth\"]')" \
    "category card → Login & Auth"
  sleep 2
  if ! have "settings-signer-entry"; then
    skip "settings-signer-entry absent — the signer screens are not on this branch"
  else
    assert_testid "settings-signer-entry" "login-auth page exposes the signer entry"
    SKIP_SIGNER=0
  fi
fi
if [ "$SKIP_SIGNER" = "0" ]; then
click_js "document.querySelector('[data-testid=\"settings-signer-entry\"]')" "open signer"
sleep 2
assert_testid "signer-screen" "signer screen mounted"
assert_testid "signer-paste" "paste entry present"
# Seeded profiles keep their signed history, so empty is not the only valid state here.
activity_state=$(attr_of "signer-activity-list" "data-state")
activity_state="${activity_state%$'\r'}"
case "$activity_state" in
  empty|loading|ready|error) ok "signer-activity-list state=$activity_state" ;;
  *) fail "signer-activity-list data-state invalid (got: ${activity_state:-<absent>})" ;;
esac
activity_count=$(attr_of "signer-activity-list" "data-count")
activity_count="${activity_count%$'\r'}"
case "$activity_count" in
  ''|*[!0-9]*) fail "signer-activity-list data-count is not a number (got: ${activity_count:-<absent>})" ;;
  *) ok "recent signatures: $activity_count" ;;
esac
shot signer-hub
fi

# ── report ───────────────────────────────────────────────────────────────────
if [ "$FAILED" -eq 0 ]; then
  printf '\n\033[32mall checks passed\033[0m (%d skipped)\n' "$SKIPPED"
else
  printf '\n\033[31msome checks failed\033[0m — screenshot was taken above (orca reports the path)\n'
fi
exit "$FAILED"

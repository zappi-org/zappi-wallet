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

# A plain `el.value = x` never reaches React state: the controlled input keeps its old
# value and every later assertion reads a screen the user never typed into.
type_into() { # <testid> <text>
  local out
  out=$(orca eval --expression "(el => { if (!el) return 'missing'; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '$2'); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value === '$2' ? 'typed' : 'mismatch' })(document.querySelector('[data-testid=\"$1\"]'))" 2>/dev/null)
  if [ "$out" = "typed" ]; then ok "typed '$2' into $1"; else fail "could not type into $1 (got: ${out:-<no output>})"; fi
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
# The script owns its seed: it lands in localStorage (origin-scoped, survives reload) and the
# app prefers it over its built-in vector at wallet creation. `AGENT_UI_SEED` overrides.
SEED_PHRASE="${AGENT_UI_SEED:-abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about}"
orca goto --url "$BASE/" >/dev/null 2>&1   # origin must exist before storage works
# localStorage is per origin (scheme+host+port): injecting into http://, or 127.0.0.1 while
# booting on localhost, silently seeds a different store and the run falls back to the built-in
# vector. Compare against the URL we boot with instead of trusting the navigation.
same_origin=$(orca eval --expression "String(new URL('$BASE').origin === location.origin)" 2>/dev/null | tr -d '\r\n')
[ "$same_origin" = "true" ] && ok "injection origin matches $BASE" \
  || fail "injection origin is ${same_origin:-unknown} — expected $(printf '%s' "$BASE" | sed -E 's#(^[a-z]+://[^/]+).*#\1#')"
orca storage local set --key zappi.dev-seed --value "$SEED_PHRASE" >/dev/null 2>&1 \
  && ok "seed injected (localStorage zappi.dev-seed)" \
  || fail "could not inject the seed"
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

# ── 4. npubcash username sheet (needs `./scripts/npubcash-dev.sh up app`) ─────
# The fee is paid from a real balance, so this section only spends when the payment is
# already covered: with a short balance the correct UI is the blocked notice, and the pay
# path is skipped rather than funded on the fly. Reset the stack between funded runs.
step "npubcash my address"
if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/api/v2/auth/nip98 2>/dev/null)" != "401" ]; then
  skip "npubcash server not answering on :8000 — run ./scripts/npubcash-dev.sh up app"
else
  # Back to Home first: the dock is a tab-screen affordance, so a pushed screen from the
  # section above leaves no way to navigate.
  orca goto --url "$BASE/?seed=1&mode=standalone" >/dev/null 2>&1
  wait_testid "app-ready" 30 || fail "app never came back after navigation"
  click_js "document.querySelector('[data-testid=\"app-nav-tab\"][data-item-id=\"settings\"]')" "dock tab → Settings"
  sleep 1
  click_js "document.querySelector('[data-testid=\"settings-category-row\"][data-item-id=\"category-profile\"]')" "category card → Profile"
  sleep 1
  click_js "document.querySelector('[data-testid=\"settings-page-row\"][data-item-id=\"my-address\"]')" "row → My address"
  sleep 3
  if wait_testid "my-address-value" 15; then
    ok "alias handle present: $(orca eval --expression "document.querySelector('[data-testid=\"my-address-value\"]').textContent" 2>/dev/null)"
    assert_testid "my-address-edit" "edit handle present"
    assert_testid "my-address-mint-edit" "deposit-mint change handle present"
    click_js "document.querySelector('[data-testid=\"my-address-edit\"]')" "pencil → username sheet"
    sleep 1
    type_into "change-username-input" "agent$RANDOM"
    click_js "document.querySelector('[data-testid=\"change-username-submit\"]')" "변경 → price check"
    wait_testid "change-username-pay" 20 || fail "confirm card never rendered the pay button"
    # Ghost-load is 1s; the notice only settles after it, so read late.
    sleep 2
    notice=$(attr_of "change-username-notice" "data-state"); notice=${notice%$'\r'}
    case "$notice" in
      info|blocked) ok "notice state=$notice (blocked only while the user can still act)" ;;
      *) fail "change-username-notice data-state unexpected (got: ${notice:-<absent>})" ;;
    esac
    if [ "$notice" = "info" ]; then
      # Pay can still land on the funding sheet: the notice says a payable source exists,
      # not that the payment mint itself is funded. That is the cross-mint swap path, which
      # this runbook does not own (it spends from two mints and needs a funded source).
      orca eval --expression "document.querySelector('[data-testid=\"change-username-pay\"]').click()" >/dev/null 2>&1
      sleep 3
      if have "mint-select-card"; then
        swap_src=$(orca eval --expression "Array.from(document.querySelectorAll('[data-testid=\"mint-select-card\"]')).map(function(e){return e.dataset.itemId}).join(',')" 2>/dev/null)
        skip "payment mint is short — funding sheet opened for swap from ${swap_src:-<none>} (swap path tested separately)"
        click_js "Array.from(document.querySelectorAll('button')).find(function(b){return /^(\\s*Cancel|취소)\\s*$/.test(b.textContent.trim())})" "cancel funding sheet"
      else
      # The regression this guards: mid-payment the balance dips as proofs lock, which used
      # to paint the noPayableMint line over a payment that was already running.
      orca eval --expression "(function(){ window.__notice=[]; const b=document.querySelector('[data-testid=\"change-username-pay\"]'); if (b) b.click(); const h=setInterval(function(){ const n=document.querySelector('[data-testid=\"change-username-notice\"]'); window.__notice.push(n ? n.getAttribute('data-state') : 'none') }, 40); setTimeout(function(){ clearInterval(h) }, 9000); return 'paying' })()" >/dev/null 2>&1
      sleep 10
      samples=$(orca eval --expression "String((window.__notice||[]).length)" 2>/dev/null | tr -d '\r')
      blocked=$(orca eval --expression "String((window.__notice||[]).filter(s => s === 'blocked').length)" 2>/dev/null | tr -d '\r')
      if [ "${blocked:-1}" = "0" ] && [ "${samples:-0}" -gt 10 ]; then
        ok "paying window: 0/$samples 'blocked' samples"
      else
        fail "paying window: blocked=$blocked of $samples samples (0 expected, >10 required)"
      fi
      assert_testid "change-username-success" "success card"
      shot npubcash-username
      fi
    else
      skip "balance does not cover the fee — pay path not exercised"
    fi
  else
    skip "no address registered yet — tap Register on My address, then rerun"
  fi
fi

# ── report ───────────────────────────────────────────────────────────────────
if [ "$FAILED" -eq 0 ]; then
  printf '\n\033[32mall checks passed\033[0m (%d skipped)\n' "$SKIPPED"
else
  printf '\n\033[31msome checks failed\033[0m — screenshot was taken above (orca reports the path)\n'
fi
exit "$FAILED"

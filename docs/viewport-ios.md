# iOS standalone full-bleed viewport

## Problem

iOS only grants the full-screen coordinate space to a standalone web app when the document is at least screen-height tall. At cold start `dvh` under-reports the available space, which can lock the app into a reduced viewport. This was the source of the 2026-07 "dead band" bug.

## Strategy

The fix is split into three layers. Each layer is gated on the previous one, so legacy installs and other platforms stay on the default path.

### 1. Detection — `public/standalone-gate.js`

Sets `html.standalone` only when **all** of the following hold:

- The app is running as an installed iOS app (`navigator.standalone === true`).
- The webview actually has full-bleed geometry (`env(safe-area-inset-top) > 0`).

The geometry probe is required because installs made under the old default status-bar mode keep a shorter webview even after the code is updated. `env()` can read `0` for the first frames after a cold launch, so the probe retries briefly.

The script is loaded from an external file because the production CSP blocks inline scripts.

### 2. Shell — `src/index.css`

- Default shell (`html`, `body`, `#root`) uses `100dvh` so browser tabs track dynamic toolbars.
- When `html.standalone` is present, the shell switches to `100lvh`. `lvh` resolves to the full screen in standalone, preventing the cold-start dead band.
- Nothing inside a standalone screen should size from `dvh`/`svh`/`100%` chains; screens use `h-full` and fill the shell.

### 3. Layout patches

These compensate for iOS sizing fixed elements from an ICB that excludes the status bar.

- **`src/ui/navigation/stackflow.tsx`**: each activity keeps a resting `translate3d(0, 0, 0)` so it becomes the containing block for its fixed descendants. Their geometry then follows the lvh-sized activity box, not the mis-reported ICB.
- **`src/index.css`**:
  - `.standalone .fixed.inset-0`: anchor from `top: 0` and set `height: 100lvh` instead of `bottom: 0`, so full-cover backdrops dim to the physical bottom.
  - `.standalone .bottom-dock`: same rotation workaround for bottom-anchored chrome; the inner content sits at the flex end.
- **`src/ui/hooks/use-keyboard-inset.ts`**: full-bleed standalone reports phantom insets up to the status-bar height even with no keyboard. Real soft keyboards are 216px+, so `MIN_KEYBOARD_PX = 100` filters phantoms while knowingly sacrificing the ~55px hardware-keyboard accessory bar.
- **`src/ui/components/layout/TabToolbar/styles.ts`**: bottom nav padding uses `max(base, env(safe-area-inset-bottom) + gap)` so the dock floats above the home indicator on iOS and keeps base spacing on Android/desktop.

## When to revisit

- iOS changes ICB sizing for fixed elements.
- The hardware-keyboard accessory bar needs to be supported.
- Android gains a top safe-area inset that would make the lvh path applicable.

// Sets html.standalone before first paint when BOTH hold:
// (1) running installed — the display-mode media query alone is unreliable
//     there (measured false on iOS 26.3), so navigator.standalone backs it
//     up; and
// (2) the webview actually has full-bleed geometry — installs made under
//     the old "default" status-bar mode keep their non-bleed webview after
//     a code update, and the lvh shell would overshoot it by the status-bar
//     height. env(safe-area-inset-top) > 0 is the physical signal of
//     full-bleed; it can read 0 for the first frames after a cold launch,
//     so keep probing briefly. The class is add-only. Legacy installs and
//     Android stay on the dvh shell.
// External file, not inline: the production CSP allows same-origin scripts
// only (script-src 'self'), so an inline gate would be silently blocked —
// exactly the failure it exists to prevent.
(function () {
  var installed =
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches ||
    navigator.standalone === true;
  if (!installed) return;
  var probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:-9999px;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.documentElement.appendChild(probe);
  var tries = 0;
  function check() {
    if (probe.offsetHeight > 0) {
      document.documentElement.classList.add('standalone');
      return true;
    }
    return false;
  }
  if (!check()) {
    var timer = setInterval(function () {
      if (check() || ++tries > 30) clearInterval(timer);
    }, 100);
    window.addEventListener('resize', check);
  }
})();

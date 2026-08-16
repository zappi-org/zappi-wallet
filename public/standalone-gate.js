// Detects installed iOS with full-bleed geometry and adds html.standalone.
// See docs/viewport-ios.md for the full strategy.
// External file: the production CSP blocks inline scripts.
(function () {
  if (navigator.standalone !== true) return;
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

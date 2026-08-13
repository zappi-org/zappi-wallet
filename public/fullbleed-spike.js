    var LS_KEY = 'fb-spike-log-v5';
    var lastSnap = '';
    function h(id) { return document.getElementById(id).offsetHeight; }
    function snapshot() {
      var vv = window.visualViewport;
      var ov = document.getElementById('overlayProbe').getBoundingClientRect();
      var tab = document.getElementById('tabbar').getBoundingClientRect();
      return {
        t: new Date().toISOString().slice(11, 19),
        ua: (navigator.userAgent.match(/OS (\d+_\d+(_\d+)?)/) || [,'?'])[1],
        standalone: navigator.standalone === true ? 1 : 0,
        scr: window.screen.height,
        inH: window.innerHeight,
        ch: document.documentElement.clientHeight,
        vvH: vv ? Math.round(vv.height) : -1,
        envT: h('pTop'), envB: h('pBottom'),
        vh: h('pVh'), dvh: h('pDvh'), svh: h('pSvh'), lvh: h('pLvh'),
        ovBot: Math.round(ov.bottom), tabBot: Math.round(tab.bottom),
      };
    }
    function fmt(s) {
      return s.t + ' scr:' + s.scr + ' in:' + s.inH + ' ch:' + s.ch + ' vv:' + s.vvH +
        ' env:' + s.envT + '/' + s.envB +
        ' vh:' + s.vh + ' dvh:' + s.dvh + ' svh:' + s.svh + ' lvh:' + s.lvh +
        ' ov:' + s.ovBot + ' tab:' + s.tabBot;
    }
    function loadLog() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
    function record(trigger) {
      var s = snapshot();
      var line = fmt(s) + ' <' + trigger + '>';
      var key = line.replace(/^\S+ /, '').replace(/ <.*$/, '');
      if (key === lastSnap && trigger === 'poll') return;
      lastSnap = key;
      var lines = loadLog(); lines.push(line);
      try { localStorage.setItem(LS_KEY, JSON.stringify(lines.slice(-150))); } catch (e) {}
      render(s, lines);
    }
    function render(s, lines) {
      var rows = [
        ['iOS(UA) / standalone', (s.ua || '?').replace(/_/g, '.') + ' / ' + (s.standalone ? 'YES' : 'NO — 홈 화면 추가 후 아이콘으로 실행'), !s.standalone],
        ['screen / innerHeight', s.scr + ' / ' + s.inH, s.standalone && s.inH !== s.scr],
        ['env top / bottom', s.envT + ' / ' + s.envB, s.standalone && s.envT === 0],
        ['vh / dvh / svh / lvh', s.vh + ' / ' + s.dvh + ' / ' + s.svh + ' / ' + s.lvh, false],
        ['빨간선 바닥 (=' + s.scr + '이면 성공)', s.ovBot, s.standalone && s.ovBot !== s.scr],
        ['초록 바닥 (=' + s.scr + '이면 성공)', s.tabBot, s.standalone && s.tabBot !== s.scr],
      ];
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        html += '<tr' + (rows[i][2] ? ' class="warn"' : '') + '><td>' + rows[i][0] + '</td><td>' + rows[i][1] + '</td></tr>';
      }
      document.getElementById('metrics').innerHTML = html;
      document.getElementById('log').textContent = lines.slice(-30).reverse().join('\n');
    }
    ['pageshow', 'resize', 'orientationchange', 'focusout'].forEach(function (ev) {
      window.addEventListener(ev, function () { record(ev); setTimeout(function () { record(ev + '+400ms'); }, 400); });
    });
    document.addEventListener('visibilitychange', function () { record('vis:' + document.visibilityState); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { record('vv-resize'); });
    setInterval(function () { record('poll'); }, 1000);
    document.getElementById('dimBtn').addEventListener('click', function () {
      document.getElementById('dim').classList.add('on');
    });
    document.getElementById('copyBtn').addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(loadLog().join('\n'));
    });
    record('boot');

document.getElementById('dim').addEventListener('click', function () { this.classList.remove('on'); });

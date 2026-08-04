// 로아도쓰 콘텐츠 페이지 공통 스크립트: 테마 동기화 · 탭 전환
(function () {
    function laTrack(event, p) {
        window.dataLayer = window.dataLayer || [];
        var o = Object.assign({}, p || {});
        o.event = event;
        window.dataLayer.push(o);
    }

    if (localStorage.getItem('loa_theme') === 'light') document.body.classList.add('light-mode');
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', function () {
        var light = document.body.classList.toggle('light-mode');
        localStorage.setItem('loa_theme', light ? 'light' : 'dark');
        laTrack('theme_change', { theme: light ? 'light' : 'dark' });
    });

    // 탭 전환: .js-tabs (계산 모드 카드 · FAQ 카테고리)
    document.querySelectorAll('.js-tabs').forEach(function (group) {
        var tabs = [].slice.call(group.querySelectorAll('[data-tab]'));
        var panels = [].slice.call(group.querySelectorAll('[data-panel]'));
        var param = group.getAttribute('data-urlparam');
        var trackGroup = group.getAttribute('data-track');

        function activate(key, updateUrl) {
            if (!panels.some(function (p) { return p.getAttribute('data-panel') === key; })) return;
            tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === key); });
            panels.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === key); });
            if (param && updateUrl && window.history && history.replaceState) {
                try {
                    var u = new URL(window.location.href);
                    u.searchParams.set(param, key);
                    history.replaceState(null, '', u);
                } catch (e) {}
            }
        }

        group.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target.closest('[data-tab]') : null;
            if (t && group.contains(t)) {
                e.preventDefault();
                var key = t.getAttribute('data-tab');
                activate(key, true);
                if (trackGroup) laTrack('content_tab', { tab_group: trackGroup, tab: key });
            }
        });

        if (param) {
            try {
                var init = new URL(window.location.href).searchParams.get(param);
                if (init) activate(init, false);
            } catch (e) {}
        }
    });
})();

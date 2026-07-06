// 로아도쓰 콘텐츠 페이지 공통 스크립트: 테마 동기화
(function () {
    if (localStorage.getItem('loa_theme') === 'light') document.body.classList.add('light-mode');
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', function () {
        var light = document.body.classList.toggle('light-mode');
        localStorage.setItem('loa_theme', light ? 'light' : 'dark');
    });
})();

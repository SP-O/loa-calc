(function () {
    var params = new URLSearchParams(location.search);

    // GTM dataLayer 이벤트 (부모 iframe과 무관하게 이 페이지의 GTM 컨테이너로 수집)
    function track(event, p) {
        window.dataLayer = window.dataLayer || [];
        var o = Object.assign({}, p || {});
        o.event = event;
        window.dataLayer.push(o);
    }

    function applyTheme(mode) {
        document.body.classList.toggle('light-mode', mode === 'light');
    }
    applyTheme(params.get('theme'));

    // 시세 표기: 천 단위 이상은 소수점이 의미 없어 정수로, 그 아래(십·백원대)만 소수 1자리 유지
    function formatPrice(n) {
        if (n === null || n === undefined || isNaN(n)) return '-';
        var v = Number(n);
        if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
        return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }


    var app = Vue.createApp({
        data: function () {
            return {
                partySize: 8,
                customSize: null,
                price: null,
                mode: 'sell',
                items: [],
                listError: false,
                search: '',
                selected: null,
                stats: null,
                statsLoading: false,
                statsCache: {},
                autoTimer: null,
                sizeTimer: null,
                autoMatched: false,
                tip: { show: false, text: '', note: '', style: {}, dir: 'right', formula: null },
                copiedMsg: '',
                copiedTimer: null,
                isLight: params.get('theme') === 'light'
            };
        },
        computed: {
            N: function () {
                var c = Number(this.customSize);
                return (c >= 2 && c <= 99) ? c : this.partySize;
            },
            result: function () {
                if (!(this.price > 0)) return { feeAdjusted: 0, breakeven: 0, rows: [] };
                return AuctionCalc.computeAuction(this.price, this.N, this.mode);
            },
            filteredItems: function () {
                var q = this.search.trim();
                if (!q) return this.items;
                return this.items.filter(function (i) { return i.name.indexOf(q) !== -1; });
            },
            // 입력 시세와 가장 가까운 아이템 — 우측에 자동으로 띄울 대상
            nearestItem: function () {
                var p = Number(this.price);
                if (!(p > 0) || !this.items.length) return null;
                var best = null, bestD = Infinity;
                this.items.forEach(function (i) {
                    if (!(i.price > 0)) return;
                    var d = Math.abs(i.price - p);
                    if (d < bestD) { bestD = d; best = i; }
                });
                return best;
            },
            // 자동 표시된 것 다음으로 가까운 후보들(현재 보고 있는 아이템은 제외)
            similarItems: function () {
                var p = Number(this.price);
                if (!(p > 0) || !this.items.length) return [];
                var sel = this.selected;
                return this.items
                    .filter(function (i) { return i.price > 0 && (!sel || i.id !== sel.id); })
                    .map(function (i) { return { item: i, d: Math.abs(i.price - p) }; })
                    .sort(function (a, b) { return a.d - b.d; })
                    .slice(0, 4)
                    .map(function (x) { return x.item; });
            },
            // 툴팁 본문을 토큰으로 분해 — 골드 아이콘 / 줄바꿈 / 굵게 처리
            tipTokens: function () {
                var out = [];
                (this.tip.text || '').split('\n').forEach(function (line, li) {
                    if (li) out.push({ t: 'br' });
                    line.split(/(\*\*[^*]+\*\*|!![^!]+!!|\{G\})/).forEach(function (part) {
                        if (!part) return;
                        if (part === '{G}') out.push({ t: 'gold' });
                        else if (part.slice(0, 2) === '**' && part.slice(-2) === '**') out.push({ t: 'b', v: part.slice(2, -2) });
                        else if (part.slice(0, 2) === '!!' && part.slice(-2) === '!!') out.push({ t: 'w', v: part.slice(2, -2) });
                        else out.push({ t: 'text', v: part });
                    });
                });
                return out;
            },
            volColor: function () {
                return this.isLight ? 'oklch(0.7686 0.1647 70.0793)' : 'oklch(0.9052 0.1657 98.1203)';
            }
        },
        methods: {
            fmt: function (n) {
                if (n === null || n === undefined || isNaN(n)) return '-';
                return Number(n).toLocaleString();
            },
            fmtPrice: function (n) { return formatPrice(n); },
            // 인게임 골드·인원은 정수뿐 — 소수점 이하는 버리고(1.5→1) 나머지 문자는 제거
            onIntInput: function (e, key) {
                var raw = String(e.target.value);
                var clean = raw.split('.')[0].replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
                if (raw !== clean) e.target.value = clean;
                this[key] = clean === '' ? null : Number(clean);
            },
            pickParty: function (n) {
                this.partySize = n;
                this.customSize = null;
                track('auction_party_change', { party_size: n });
            },
            // {G}=골드 아이콘, \n=줄바꿈, **텍스트**=굵게
            stratTip: function (row) {
                var f = this.fmt;
                var isUse = this.mode === 'use';
                var raise = f(row.raise);
                // 손해 = 상회 입찰가 − 분기점. "본전 가격에 먹었을 때보다 얼마나 덜 버는가"와 같은 값이며,
                // 모든 행을 같은 잣대(분기점)로 재므로 표를 위아래로 훑을 때 일관되게 읽힘.
                var loss = f(Math.max(0, row.raise - this.result.breakeven));

                if (row.key === 'breakeven') {
                    return (isUse ? '낙찰 후 사용하여 얻는 이득과' : '낙찰 후 판매 시의 이득과')
                        + '\n분배금으로 받는 이득이 **동일한 금액**입니다.'
                        + '\n여기서 한 번 더 입찰하면'
                        + '\n(최소 ' + raise + '{G}) ' + loss + '{G} 손해입니다.'
                        + '\n다른 사람이 입찰해주면 ' + f(row.raiseBonus) + '{G} 더 벌게 됩니다.';
                }
                if (row.key === 'safe') {
                    return '내가 낙찰받든 다른 사람이 입찰하든'
                        + '\n**어떤 상황에서도 이득**을 보는 최적의 금액입니다.'
                        + '\n여기서 한 번 더 입찰하면 손익 분기점을 넘겨'
                        + '\n(최소 ' + raise + '{G}) ' + loss + '{G} 손해입니다.';
                }
                if (row.key === 'preempt') {
                    return '**가장 큰 이득**을 노릴 수 있는 금액입니다.'
                        + '\n다만, 직접 사용하려는 사람이 있을 경우,'
                        + '\n실사용자가 입찰 시(최소 ' + raise + '{G})'
                        + '\n' + f(Math.abs(row.userRaise)) + '{G} 이득이라 !!뺏길 수 있습니다!!.';
                }
                if (row.rebids === 1) {
                    return '한 번 던져볼만한 가격입니다.'
                        + '\n누군가 입찰해도(최소 ' + raise + '{G}) **바로 재입찰**하면,'
                        + '\n' + (row.landingLabel || '손익 분기점') + '인 ' + f(row.landing) + '{G}로 입찰할 수 있습니다.';
                }
                if (row.rebids) {
                    return '날로 먹어보는 가격입니다.'
                        + '\n누군가 입찰해도(최소 ' + raise + '{G}) **' + row.rebids + '번까지 재입찰**하여'
                        + '\n' + (row.landingLabel || '손익 분기점') + '(' + f(row.landing) + '{G})으로 입찰할 수 있습니다.';
                }
                return '';
            },
            // 본문 아래에 작게 덧붙이는 회색 보충 설명
            stratNote: function (row) {
                if (row.key === 'breakeven' && this.mode === 'use') {
                    return '판매 수수료 5%를 제외하고 계산된 손익 분기점입니다.';
                }
                return '';
            },
            // 수식은 분기점에만 공개(나머지 전략은 로아도쓰 고유 계산이라 결과만 노출)
            stratFormula: function (row) {
                if (row.key !== 'breakeven' || !(this.price > 0)) return null;
                var f = this.fmt, k = this.N - 1, den = (k + 0.95).toFixed(2);
                var isUse = this.mode === 'use';
                return {
                    expr: (isUse ? f(this.price) : '(' + f(this.price) + ' - ' + f(Math.round(this.price * 0.05)) + ')')
                        + ' × ' + k + ' ÷ ' + den,
                    // 판매 목적은 문구가 길어 한 줄을 넘으므로 연산자 앞에서 끊고, 짧은 직접 사용은 한 줄 유지
                    legend: isUse
                        ? '(아이템 시세) × 나 제외 인원 ÷ (나 제외 인원 + 0.95)'
                        : '(아이템 시세 - 판매 수수료 5%) × 나 제외 인원\n÷ (나 제외 인원 + 0.95)',
                    note: '0.95 = 낙찰 금액 전체에서 수수료 5%를 뗀 뒤 분배되기 때문'
                };
            },
            showTip: function (e, row) {
                var text = this.stratTip(row);
                if (!text) return;
                var r = e.currentTarget.getBoundingClientRect();
                var W = 300, gap = 9, style, dir;
                var midY = (r.top + r.height / 2) + 'px';
                if (r.right + gap + W <= window.innerWidth - 8) {
                    dir = 'right';
                    style = { left: (r.right + gap) + 'px', top: midY, width: W + 'px' };
                } else if (r.left - gap - W >= 8) {
                    dir = 'left';                                                              // 왼쪽으로 뒤집기
                    style = { left: (r.left - gap - W) + 'px', top: midY, width: W + 'px' };
                } else {
                    // 양옆 모두 공간이 없으면 행을 가리지 않도록 아래에 표시
                    dir = 'below';
                    var w = Math.min(W, window.innerWidth - 16);
                    style = {
                        left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px',
                        top: (r.bottom + gap) + 'px', width: w + 'px', transform: 'none'
                    };
                }
                this.tip = { show: true, text: text, note: this.stratNote(row), style: Object.assign({}, style, { whiteSpace: 'pre-line', wordBreak: 'keep-all' }), dir: dir, formula: this.stratFormula(row) }; },
            hideTip: function () { this.tip.show = false; },
            diffLabel: function (item) {
                var d = item.price - this.price;
                if (!this.price) return '';
                return (d >= 0 ? '+' : '') + this.fmt(d);
            },
            copyBid: function (row) {
                var self = this;
                var text = String(row.bid);
                track('auction_copy_bid', { strategy: row.key, party_size: this.N, auction_mode: this.mode });
                var done = function () {
                    self.copiedMsg = row.label + ' ' + self.fmt(row.bid) + ' G 복사됨';
                    clearTimeout(self.copiedTimer);
                    self.copiedTimer = setTimeout(function () { self.copiedMsg = ''; }, 1600);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(function () { self.fallbackCopy(text, done); });
                } else {
                    this.fallbackCopy(text, done);
                }
            },
            fallbackCopy: function (text, done) {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); done(); } catch (e) {}
                document.body.removeChild(ta);
            },
            fetchList: function () {
                var self = this;
                fetch('/api/auction-market')
                    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
                    .then(function (j) {
                        self.items = j.items || [];
                        // 목록보다 시세 입력이 빨랐던 경우에도 자동 표시
                        if (!self.selected) self.autoMatch();
                    })
                    .catch(function () { self.listError = true; });
            },
            selectItem: function (item) {
                this.autoMatched = false;   // 직접 고른 경우
                track('auction_item_select', { source: 'click' });
                this.selected = item;
                if (!(this.price > 0)) this.price = item.price;
                this.loadStats(item);
            },
            // 시세 입력이 멈추면 가장 값이 가까운 아이템을 우측에 자동 표시
            autoMatch: function () {
                var n = this.nearestItem;
                if (!n || (this.selected && this.selected.id === n.id)) return;
                this.autoMatched = true;
                track('auction_item_select', { source: 'auto' });
                this.selected = n;
                this.loadStats(n);
            },
            loadStats: function (item) {
                var self = this;
                var cached = this.statsCache[item.id];
                if (cached) {
                    this.stats = cached;
                    this.$nextTick(function () { self.renderChart(); });
                    return;
                }
                this.stats = null;
                this.statsLoading = true;
                fetch('/api/auction-market?item=' + item.id)
                    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
                    .then(function (j) {
                        self.statsCache[item.id] = j;
                        if (self.selected && self.selected.id === item.id) {
                            self.stats = j;
                            self.$nextTick(function () { self.renderChart(); });
                        }
                    })
                    .catch(function () { self.stats = { history: [] }; })
                    .finally(function () { self.statsLoading = false; });
            },
            renderChart: function () {
                var canvas = document.getElementById('aucChartCanvas');
                if (!canvas || !this.stats || !this.stats.history || !this.stats.history.length) return;
                if (window.aucChartInstance) window.aucChartInstance.destroy();

                var isLight = this.isLight;
                var textColor = isLight ? 'oklch(0.4495 0 0)' : 'oklch(0.738 0 0)';
                var gridColor = isLight ? 'oklch(0.9266 0.0092 258.0793)' : 'oklch(0.3211 0 0)';
                // 선 위계: 축 기준선(진함) > 가로 격자(은은)
                var axisColor = isLight ? 'oklch(0.63 0.016 258)' : 'oklch(0.6 0 0)';
                var gridH = isLight ? 'oklch(0.88 0.008 258)' : 'oklch(0.38 0 0)';
                var data = this.stats.history.slice().reverse();
                var labels = data.map(function (d) { return d.date; });
                var prices = data.map(function (d) { return d.avgPrice; });
                var volumes = data.map(function (d) { return d.volume || 0; });

                // 판매량(y1) 눈금을 깔끔한 단위로 정렬
                var maxVol = Math.max.apply(null, volumes.concat([1]));
                var rawStep = maxVol / 4;
                var mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
                var norm = rawStep / mag;
                var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;

                window.aucChartInstance = new Chart(canvas, {
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                type: 'line',
                                label: '평균 거래가',
                                data: prices,
                                borderColor: 'oklch(0.6231 0.1881 259.8314)',
                                backgroundColor: 'oklch(0.6231 0.1881 259.8314)',
                                // y축이 0부터 시작하지 않아 면적을 칠하면 변동폭이 과장돼 보이고 막대도 가려짐
                                fill: false,
                                tension: 0.3,
                                pointRadius: 2.5,
                                pointHoverRadius: 4,
                                borderWidth: 2,
                                yAxisID: 'y'
                            },
                            {
                                type: 'bar',
                                label: '판매 건수',
                                data: volumes,
                                backgroundColor: this.volColor,
                                borderRadius: 2,
                                barPercentage: 0.55,
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: function (ctx) {
                                        var v = ctx.parsed.y;
                                        // 거래가는 천 단위 이상이면 소수점 생략, 판매 건수는 항상 정수
                                        return ctx.dataset.label + ': ' + (ctx.dataset.yAxisID === 'y1' ? Number(v).toLocaleString() : formatPrice(v));
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                // autoSkip을 끄지 않으면 폭이 좁을 때 날짜가 격일로 건너뛰어 표시됨
                                ticks: { color: textColor, font: { size: 10 }, padding: 4, autoSkip: false },
                                // 막대가 이미 날짜 구간을 나눠주므로 세로 격자선은 중복 — 표시하지 않음
                                grid: { display: false, tickLength: 0 },
                                border: { color: axisColor, width: 1 }
                            },
                            y: {
                                position: 'left',
                                ticks: { color: textColor, font: { size: 10 }, padding: 6, callback: function (v) { return formatPrice(v); } },
                                // 눈금마다 가로 격자선 — 값을 눈으로 따라가기 쉽게, 얇고 은은하게
                                grid: { display: true, color: gridH, lineWidth: 1, drawTicks: false },
                                border: { display: true, color: axisColor, width: 1 }
                            },
                            y1: {
                                position: 'right',
                                beginAtZero: true,
                                max: step * 5,
                                ticks: { color: textColor, font: { size: 10 }, padding: 6, stepSize: step, callback: function (v) { return Number(v).toLocaleString(); } },
                                grid: { drawOnChartArea: false, drawTicks: false },
                                border: { display: false }
                            }
                        }
                    }
                });
            }
        },
        watch: {
            // 타이핑 중간값(1→10→100…)마다 조회하지 않도록 입력이 멎은 뒤에 실행
            price: function () {
                var self = this;
                this.hideTip();          // 값이 바뀌면 떠 있던 툴팁은 옛 정보라 즉시 닫음
                clearTimeout(this.autoTimer);
                this.autoTimer = setTimeout(function () {
                    self.autoMatch();
                    if (self.price > 0) track('auction_calc', { party_size: self.N, auction_mode: self.mode });
                }, 450);
            },
            mode: function (v) {
                this.hideTip();
                track('auction_mode_change', { auction_mode: v });
            },
            partySize: function () { this.hideTip(); },
            customSize: function () {
                var self = this;
                this.hideTip();
                // 직접 입력은 타이핑 중간값(1→1→16)마다 잡히므로 입력이 멎은 뒤 유효한 값만 보고
                clearTimeout(this.sizeTimer);
                this.sizeTimer = setTimeout(function () {
                    var c = Number(self.customSize);
                    if (c >= 2 && c <= 99) track('auction_party_change', { party_size: c });
                }, 500);
            }
        },
        mounted: function () {
            var self = this;
            this.fetchList();

            // 부모(로아도쓰)로부터 테마 변경 수신
            window.addEventListener('message', function (e) {
                var d = e.data;
                if (d && d.type === 'theme') {
                    applyTheme(d.mode);
                    self.isLight = d.mode === 'light';
                    if (self.stats) self.$nextTick(function () { self.renderChart(); });
                }
            });

            // 부모 iframe 높이 동기화 — 부모의 기존 tipago-height 핸들러를 재사용
            var lastH = 0;
            var report = function () {
                // documentElement.scrollHeight는 부모가 지정한 iframe 높이를 그대로 따라가므로
                // 한 번 커지면 줄지 않음(창을 줄였다 늘리면 빈 공간이 남음). 콘텐츠 높이인 body 기준으로 보고.
                var h = document.body.scrollHeight;
                if (h !== lastH) {
                    lastH = h;
                    try { parent.postMessage({ type: 'tipago-height', height: h }, '*'); } catch (e) {}
                }
            };
            report();
            if (window.ResizeObserver) {
                new ResizeObserver(report).observe(document.body);
            } else {
                setInterval(report, 800);
            }
        }
    });
    app.mount('#app');
})();

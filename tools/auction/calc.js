// 경매 분배 계산 — 순수 함수 (DOM/네트워크 의존 없음)
// 규칙: 낙찰자가 입찰가 B 지불 → 낙찰 금액 전체에서 5% 공제 후 나머지 (N-1)명이 균등 분배
//       (2025-07-23 패치로 "10만 골드 초과분만 과금" → "낙찰 금액 전체 과금"으로 변경됨)
//       다음 입찰은 현재가의 110% 이상.
// 소수점: 수수료 올림 / 분배금 내림 / 최소 상회 입찰가 올림(110% "이상"이므로 올림이 강제됨).
//       2026-05 인게임 정산 화면(8인 · 낙찰 112,596G · 분배 15,280G)으로 실측 확인.
//       수수료를 내림하면 (112,596-5,629)/7 = 15,281 로 딱 떨어져 어떤 반올림으로도 15,280이 안 나옴.
// 상대가 상회 입찰할지 판단하는 비교 대상은 "현재 입찰가의 분배금"이므로
//   차단 조건은 상대가치 - raise(B) < dist(B). 등호를 제외하는 이유는 손익 0이면
//   아이템이 필요한 쪽이 그냥 가져가기 때문.
(function (root, factory) {
    var api = factory();
    root.AuctionCalc = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

    // ×0.05, ×1.1 은 2진 소수라 오차가 생긴다(200*1.1 = 220.00000000000003 → 올림 221).
    // 정수 곱셈으로 바꿔 계산해야 경계값이 한 골드 어긋나지 않는다.
    function feeOf(gold) { return Math.ceil(gold / 20); }
    function distOf(bid, N) { return Math.floor((bid - feeOf(bid)) / (N - 1)); }
    function raiseOf(bid) { return Math.ceil(bid * 11 / 10); }

    // 상대가 최소 금액으로 올리고 내가 최소 금액으로 되받기를 k회 반복한 뒤의 내 입찰가
    function afterRebids(start, k) {
        var v = start;
        for (var i = 0; i < k; i++) v = raiseOf(raiseOf(v));
        return v;
    }

    // price: 아이템 시세, partySize: 레이드 인원(N), mode: 'sell'(판매·수수료5%) | 'use'(직접사용)
    function computeAuction(price, partySize, mode) {
        var N = Math.floor(Number(partySize));
        var P = Math.floor(Number(price)) || 0;   // 골드는 정수 단위이므로 소수점 입력은 버림
        var Vsell = P - feeOf(P);
        var V = mode === 'use' ? P : Vsell;

        if (!(N >= 2) || P <= 0) {
            return { feeAdjusted: V, breakeven: 0, rows: [] };
        }

        function row(key, label, bid) {
            var dist = distOf(bid, N);
            var raise = raiseOf(bid);
            return {
                key: key, label: label, bid: bid,
                distribution: dist, gain: 0,
                raise: raise,                       // 상대가 상회 입찰할 때의 최소 금액(110%)
                // 남이 한 번 더 상회 입찰해주면 분배금이 그만큼 늘어 내가 더 받는 금액
                raiseBonus: distOf(raise, N) - dist,
                // 상대가 상회 입찰했을 때 그 사람의 손익(양수=이득) — 안 올리고 분배금 받는 경우 대비
                sellerRaise: (Vsell - raise) - dist,
                userRaise: (P - raise) - dist
            };
        }

        // 손익 분기점: 내가 낙찰(V - B)이 남이 같은 값에 낙찰(분배금) 이상인 최대 금액.
        // 올림/내림이 섞여 연속식과 몇 골드 어긋날 수 있어 추정값에서 내려오며 확인한다.
        var breakeven = 0;
        for (var b = Math.floor(V * (N - 1) / ((N - 1) + 0.95)) + 3; b >= 1; b--) {
            if (V - b >= distOf(b, N)) { breakeven = b; break; }
        }
        if (breakeven < 1) return { feeAdjusted: V, breakeven: 0, rows: [] };

        // 견제 금액: 상대가 최소 금액으로 상회 입찰해도 분배금보다 손해가 되는 최저 입찰가
        function blockPrice(oppValue) {
            var est = Math.max(1, Math.floor(oppValue * (N - 1) / (1.1 * (N - 1) + 0.95)) - 3);
            for (var i = est; i <= breakeven; i++) {
                if (oppValue - raiseOf(i) < distOf(i, N)) return i;
            }
            return breakeven;
        }
        // 전략가는 분기점을 넘으면 손해고 1골 미만은 입찰 자체가 불가
        var clamp = function (v) { return Math.max(1, Math.min(breakeven, v)); };
        // 추천 입찰가: 실사용 목적(거래소 수수료 없는·가치 P) 상대까지 상회 입찰을 포기하는 최저가
        var safe = clamp(blockPrice(P));
        // 최대 이득가: 판매 목적(가치 Vsell) 상대 기준 — 이 아래는 상회 입찰이 이득이라 뺏김
        var preempt = clamp(blockPrice(Vsell));

        // 판매/직접사용은 분기점 값이 다르므로 이름도 구분(같은 이름에 다른 값 → 혼란)
        var rows = [row('breakeven', mode === 'use' ? '손익 분기점(사용 목적)' : '손익 분기점', breakeven)];
        rows.push(row('safe', '추천 입찰가', safe));
        // 재입찰 사다리의 착지점은 '상대가 더 못 올리는 가격'(견제 금액). 분기점에 착지하면 이득이 0이 되지만
        // 견제 금액에 착지하면 이득을 지킨 채 마무리되고, 시작가도 더 낮게 잡을 수 있어 모든 면에서 유리함.
        // 구성은 모드로 결정한다(값 비교로 정하면 저가에서 두 값이 같아져 레이아웃이 무너짐).
        var anchor, anchorLabel, steps;
        if (mode === 'use') {
            anchor = safe; anchorLabel = '추천 입찰가';          // use 모드는 추천 = 최대 이득가라 행을 합침
            steps = ['싸게 노리기', '더 싸게 노리기'];
        } else {
            rows.push(row('preempt', '최대 이득가', preempt));
            anchor = preempt; anchorLabel = '최대 이득가';
            steps = ['싸게 노리기'];
        }
        // k회 되받아 착지점을 부를 수 있는 최대 시작가. 매 단계 올림이 붙으므로
        // 1.21^k 나눗셈만으로는 한 골드 넘칠 수 있어, 실제 사다리를 돌려 확인하며 내려온다.
        steps.forEach(function (label, i) {
            var k = i + 1;
            var s = clamp(Math.floor(anchor / Math.pow(1.21, k)) + 2);
            while (s > 1 && afterRebids(s, k) > anchor) s--;
            var r = row('try' + k, label, clamp(s));
            r.rebids = k;
            r.landing = anchor;
            r.landingLabel = anchorLabel;
            rows.push(r);
        });
        rows.forEach(function (r) { r.gain = breakeven - r.bid; });

        return { feeAdjusted: V, breakeven: breakeven, rows: rows };
    }

    // 개발용 자체검증
    function __selfTest() {
        var pass = true;
        function eq(a, b, msg) { if (a !== b) { pass = false; console.error('[calc] FAIL', msg, 'got', a, 'want', b); } }

        // 실측 근거(2026-05 정산 화면): 8인 · 낙찰 112,596G → 분배 15,280G
        eq(feeOf(112596), 5630, '수수료 올림');
        eq(distOf(112596, 8), 15280, '분배금 내림 — 실측 화면과 일치');
        eq(raiseOf(200), 220, '상회 입찰 올림(정수)');
        eq(raiseOf(75568), 83125, '상회 입찰 올림(소수)');

        var s8 = computeAuction(100000, 8, 'sell');
        eq(s8.feeAdjusted, 95000, 'sell feeAdjusted');
        eq(s8.breakeven, 83648, 'sell breakeven');
        eq(s8.rows.map(function (x) { return x.bid; }).join(','), '83648,80926,76880,63536', 'sell bids');
        eq(s8.rows.map(function (x) { return x.key; }).join(','), 'breakeven,safe,preempt,try1', 'sell keys');

        var u8 = computeAuction(100000, 8, 'use');
        eq(u8.breakeven, 88051, 'use breakeven');
        eq(u8.rows.map(function (x) { return x.key; }).join(','), 'breakeven,safe,try1,try2', 'use keys');
        eq(u8.rows[1].bid, 80926, 'use safe');

        // 전 구간 불변식
        ['sell', 'use'].forEach(function (m) {
            [2, 3, 4, 8, 16, 99].forEach(function (n) {
                [1, 2, 5, 20, 50, 137, 1000, 112596, 144898, 9999999].forEach(function (p) {
                    var r = computeAuction(p, n, m);
                    if (!r.rows.length) return;
                    var be = r.rows[0].bid, prev = Infinity;
                    var Vsell = p - feeOf(p);
                    var V = m === 'use' ? p : Vsell;
                    r.rows.forEach(function (x) {
                        if (!(x.bid >= 1)) { pass = false; console.error('[calc] FAIL 1골 미만', m, n, p, x.label); }
                        if (x.bid > be) { pass = false; console.error('[calc] FAIL 분기점 초과', m, n, p, x.label); }
                        if (x.bid > prev) { pass = false; console.error('[calc] FAIL 순서 역전', m, n, p, x.label); }
                        prev = x.bid;
                    });
                    var keys = r.rows.map(function (x) { return x.key; }).join(',');
                    var want = m === 'use' ? 'breakeven,safe,try1,try2' : 'breakeven,safe,preempt,try1';
                    if (keys !== want) { pass = false; console.error('[calc] FAIL 구성', m, n, p, keys); }
                    // 분기점: 부등식을 만족하는 최대 금액이어야 함
                    if (!(V - be >= distOf(be, n))) { pass = false; console.error('[calc] FAIL 분기점 부등식', m, n, p); }
                    if (V - (be + 1) >= distOf(be + 1, n)) { pass = false; console.error('[calc] FAIL 분기점 최대성', m, n, p); }
                    // 견제 금액: 차단이 성립하고, 1골 낮추면 성립하지 않아야 함(경계 정확성)
                    var chk = function (bid, oppV, name) {
                        if (bid >= be) return;                        // 분기점으로 잘린 경우 제외
                        if (!(oppV - raiseOf(bid) < distOf(bid, n))) { pass = false; console.error('[calc] FAIL 차단 실패', name, m, n, p, bid); }
                        if (bid > 1 && oppV - raiseOf(bid - 1) < distOf(bid - 1, n)) { pass = false; console.error('[calc] FAIL 1골 낮춰도 차단(과잉)', name, m, n, p, bid); }
                    };
                    chk(r.rows[1].bid, p, '추천');
                    var preRow = r.rows.filter(function (x) { return x.key === 'preempt'; })[0];
                    if (preRow) chk(preRow.bid, Vsell, '최대이득');
                    // 재입찰 사다리: k회 되받아 착지점 이하여야 하고, 1골 더 높으면 초과해야 함.
                    // 착지점이 너무 낮아 1골드에서 시작해도 넘는 경우(초저가)는 사다리 자체가 성립하지 않아 제외.
                    r.rows.filter(function (x) { return x.rebids; }).forEach(function (x) {
                        if (afterRebids(1, x.rebids) > x.landing) return;
                        if (afterRebids(x.bid, x.rebids) > x.landing) { pass = false; console.error('[calc] FAIL 되받기 불가', m, n, p, x.label); }
                        if (x.bid + 1 <= x.landing && afterRebids(x.bid + 1, x.rebids) <= x.landing) { pass = false; console.error('[calc] FAIL 사다리 최대성', m, n, p, x.label); }
                    });
                });
            });
        });

        console.log(pass ? '[calc] self-test PASS' : '[calc] self-test FAILED');
        return pass;
    }

    if (typeof window !== 'undefined' && /(\?|&)debug/.test(window.location.search)) __selfTest();

    return { computeAuction: computeAuction, __selfTest: __selfTest, feeOf: feeOf, distOf: distOf, raiseOf: raiseOf };
});

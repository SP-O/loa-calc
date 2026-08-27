import { test } from 'node:test';
import assert from 'node:assert/strict';

// 현재 코드가 쓰던 방식 — 비교마다 Date 객체를 두 개씩 만든다
const byDateObject = arr => arr.slice().sort((a, b) => new Date(b.Date) - new Date(a.Date));

// 교체한 방식 — 한 번만 파싱해 숫자로 정렬한다
const byParsedOnce = arr => arr.slice()
    .map(s => ({ s, t: Date.parse(s.Date) }))
    .sort((a, b) => b.t - a.t)
    .map(x => x.s);

// 쓰지 않기로 한 방식 — 날짜 형식이 고정 폭이라고 가정한다
const byStringCompare = arr => arr.slice().sort((a, b) => (a.Date < b.Date ? 1 : a.Date > b.Date ? -1 : 0));

// 로아 API 가 어떤 형식을 주는지 확정하지 못했다. 세 가지를 모두 본다.
function makeStats(days, fmt = 'pad') {
    const a = Array.from({ length: days }, (_, i) => {
        const d = new Date(Date.UTC(2026, 7, 28) - i * 86400000);
        const iso = d.toISOString();
        const Date_ = fmt === 'pad' ? iso.slice(0, 10) + ' 00:00:00'
            : fmt === 'iso' ? iso
            : `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()} 0:00:00`;
        return { Date: Date_, AvgPrice: 1800 + (i % 40) * 1.7, TradeCount: 120000 + i * 37 };
    });
    // 정렬된 입력을 주면 TimSort 가 O(n) 으로 끝나 비용을 과소평가한다
    for (let i = a.length - 1; i > 0; i--) {
        const j = (i * 7919 + 13) % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

test('어떤 날짜 형식에서도 기존 방식과 같은 순서를 만든다', () => {
    for (const fmt of ['pad', 'iso', 'nopad']) {
        for (const days of [14, 30, 90, 365]) {
            const src = makeStats(days, fmt);
            assert.deepEqual(
                byParsedOnce(src).map(s => s.Date),
                byDateObject(src).map(s => s.Date),
                `${fmt} 형식 ${days}일치에서 순서가 다르다`
            );
        }
    }
});

test('문자열 비교는 0 패딩이 없으면 깨진다 — 그래서 쓰지 않는다', () => {
    const src = makeStats(90, 'nopad');
    assert.notDeepEqual(
        byStringCompare(src).map(s => s.Date),
        byDateObject(src).map(s => s.Date),
        '이 가정이 깨지지 않는다면 더 빠른 문자열 비교로 바꿀 수 있다'
    );
});

test('365일치 22종 정렬이 10ms 미만이다', () => {
    const src = makeStats(365);
    const run = () => { for (let n = 0; n < 22; n++) byParsedOnce(src).slice(0, 14); };
    run();
    const t0 = process.hrtime.bigint();
    for (let r = 0; r < 5; r++) run();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
    assert.ok(ms < 10, `${ms.toFixed(2)}ms — Workers 무료 한도 10ms 를 넘는다`);
});

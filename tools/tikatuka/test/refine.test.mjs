// 근소차 적응형 재평가 회귀 테스트 — 실행: node --test tools/tikatuka/test/
//
// 실사례(2026-07-07 유저 스크린샷): 보너스 주사위 배치에서 진짜 승률 차이가
// 0.6%p(상대L2 75.65% vs 상대L3 75.04%, 10만 롤아웃×7시드 실측)인 국면이
// 1200롤아웃 노이즈로 "상대L3 76% > 상대L2 73%"처럼 3%p 역순으로 표시됐다.
// 재평가 후에는 ①상위 2개가 {상대L2, 상대L3}이고 ②표시 격차가 진실에 가깝게
// 줄어 근소차 안내(≤2%p)가 뜨는 상태여야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../src/solver/recommend.js';
import { isCloseCall } from '../src/solver/advice.js';

const D = (v, shield = false) => ({ value: v, shield });

// 스크린샷 보드: 내 [2,5]/[5,5]/[4], 상대 [6]/[4,3]/[3], 굴린 주사위 2(보너스)
function screenshotState({ myMit }) {
  return {
    me:  { lines: [[D(2), D(5)], [D(5), D(5)], [D(4)]], hasMitjang: myMit },
    opp: { lines: [[D(6)], [D(4), D(3)], [D(3)]], hasMitjang: false },
    turn: 'me',
  };
}

const key = (t) => `${t.side}${t.lineIndex}`;

for (const myMit of [false, true]) {
  test(`보너스 근소차 국면(리롤 ${myMit ? '보유' : '소진'}): 상위 2개 = 상대L2·상대L3, 가짜 격차 없음`, () => {
    const r = recommend(screenshotState({ myMit }), 2, { isBonus: true, seed: 1234567, precise: false });
    const top2 = new Set([key(r.options[0].target), key(r.options[1].target)]);
    // 진짜 상위 2개(고정밀 실측): 상대 라인2(잠금)와 상대 라인3
    assert.deepEqual(top2, new Set(['opp1', 'opp2']));
    // 표시 격차가 노이즈로 부풀려지지 않아야 함(진실 0.35~0.6%p → 근소차 안내 폭 2%p 이내)
    const gap = r.options[0].winProb - r.options[1].winProb;
    assert.ok(gap <= 0.02, `1·2위 표시 격차 ${(gap * 100).toFixed(2)}%p — 2%p 초과(가짜 격차)`);
    // 근소차 안내가 뜨는 상태여야 함(사용자가 동률임을 알 수 있게)
    assert.ok(isCloseCall(r.options), '근소차 안내(≤2%p)가 떠야 하는 국면');
    // 3위(상대L1)는 재평가 폭 밖 — 명확히 뒤처져야 함
    assert.ok(r.options[1].winProb - r.options[2].winProb > 0.02, '3위는 상위 2개와 명확히 구분');
  });
}

test('결정성: 같은 입력·시드는 같은 결과(재평가 포함)', () => {
  const a = recommend(screenshotState({ myMit: false }), 2, { isBonus: true, seed: 1234567, precise: false });
  const b = recommend(screenshotState({ myMit: false }), 2, { isBonus: true, seed: 1234567, precise: false });
  assert.deepEqual(
    a.options.map((o) => [key(o.target), o.winProb]),
    b.options.map((o) => [key(o.target), o.winProb]),
  );
});

test('완전탐색 경로는 재평가와 무관하게 동작(종반 국면)', () => {
  // 빈칸 4개 이하 → exact 경로
  const st = {
    me:  { lines: [[D(2), D(5), D(1)], [D(5), D(5)], [D(4), D(6), D(3)]], hasMitjang: false },
    opp: { lines: [[D(6), D(2), D(2)], [D(4), D(3)], [D(3), D(1)]], hasMitjang: false },
    turn: 'me',
  };
  const r = recommend(st, 4, { isBonus: false, seed: 7, precise: false, exactTimeMs: 10000 });
  assert.ok(r.options.length >= 1);
  for (const o of r.options) assert.ok(o.winProb >= 0 && o.winProb <= 1);
});

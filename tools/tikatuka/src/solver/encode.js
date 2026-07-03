// 게임 상태 → 신경망 입력 특징 벡터.
// 라인은 순서 무관(멀티셋)이므로 "값별 개수"로 인코딩(순열 불변).
// 각 라인: 비실드 개수[1..6](6) + 실드 개수[1..6](6) = 12.
// 6개 라인(me0..2, opp0..2) × 12 = 72, + turn + me.mitjang + opp.mitjang = 75.

export const INPUT_SIZE = 75;

function lineFeatures(line) {
  const nonShield = [0, 0, 0, 0, 0, 0];
  const shield = [0, 0, 0, 0, 0, 0];
  for (const d of line) {
    if (d.shield) shield[d.value - 1] += 1;
    else nonShield[d.value - 1] += 1;
  }
  return [...nonShield, ...shield];
}

export function encode(state) {
  const f = [];
  for (const side of ['me', 'opp']) {
    for (let i = 0; i < 3; i++) f.push(...lineFeatures(state[side].lines[i]));
  }
  f.push(state.turn === 'me' ? 1 : 0);
  f.push(state.me.hasMitjang ? 1 : 0);
  f.push(state.opp.hasMitjang ? 1 : 0);
  return f;
}

// AlphaZero용 입력 인코딩 + 행동공간 정의/마스킹.
// 행동(6): 0=내 라인0, 1=내 라인1, 2=내 라인2, 3=상대 라인0, 4=상대 라인1, 5=상대 라인2.
// 단계(phase): 'normal'(굴린 주사위 배치, 내 라인만) | 'bonus'(보너스 배치, 양쪽 가능).
// 밑장빼기는 v1 액션공간에서 제외(브라우저는 기존 classic 밑장빼기 조언 사용).

import { encode } from './encode.js';

export const NUM_ACTIONS = 6;
export const AZ_INPUT_SIZE = 75 + 1 + 6; // base 75 + isBonus(1) + die one-hot(6) = 82

export function azEncode(state, phase, die) {
  const f = encode(state); // 75
  f.push(phase === 'bonus' ? 1 : 0);
  for (let v = 1; v <= 6; v++) f.push(die === v ? 1 : 0);
  return f;
}

export function actionToTarget(a) {
  return a < 3 ? { side: 'me', lineIndex: a } : { side: 'opp', lineIndex: a - 3 };
}

export function targetToAction(side, lineIndex) {
  return (side === 'me' ? 0 : 3) + lineIndex;
}

// 합법 행동 마스크(길이 6). normal: mover의 라인 빈칸만. bonus: 양쪽 빈칸.
export function legalMask(state, phase, mover = 'me') {
  const mask = [0, 0, 0, 0, 0, 0];
  if (phase === 'bonus') {
    for (const side of ['me', 'opp']) {
      for (let i = 0; i < 3; i++) if (state[side].lines[i].length < 3) mask[targetToAction(side, i)] = 1;
    }
  } else {
    for (let i = 0; i < 3; i++) if (state[mover].lines[i].length < 3) mask[targetToAction(mover, i)] = 1;
  }
  return mask;
}

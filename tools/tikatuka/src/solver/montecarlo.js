import { cloneState, boardFull } from '../state.js';
import { gameResult, outcomeValue, decidedResult } from '../scoring.js';
import { endTurn, placeDie, resolveAlkkagi, wouldTriggerAlkkagi, legalLines } from '../rules.js';
import { rollDie, greedyMove, greedyBonusPlace, aiOpponentMove } from './evaluate.js';

const ROLLOUT_CAP = 40;

// opts.realAI: 상대('opp') 턴은 실제 AI 흉내 정책으로 둠(실전 승률 반영).
export function rollout(state, rng, opts = {}) {
  let s = cloneState(state);
  let depth = 0;
  while (!boardFull(s) && depth < ROLLOUT_CAP) {
    // 홀드: 2라인이 잠겨 승부가 이미 결정났으면 더 진행하지 않고 즉시 결과 반환.
    // (그리디 정책이 잠긴 라인을 자해 알까기로 헌납하는 것을 방지)
    const decided = decidedResult(s);
    if (decided) return outcomeValue(decided);
    const player = s.turn;
    // 상대가 먼저 꽉 차도 게임은 판 전체가 찰 때까지 계속된다("game ends when full").
    // 둘 곳 없는 플레이어는 턴만 넘기고, 빈칸 남은 플레이어가 계속 둔다.
    if (legalLines(s, player).length === 0) { s = endTurn(s); depth++; continue; }
    const r = rollDie(rng);
    const move = opts.realAI && player === 'opp' ? aiOpponentMove(s, r, rng) : greedyMove(s, r, rng);
    if (!move) { s = endTurn(s); depth++; continue; }
    if (move.alkkagi) {
      s = resolveAlkkagi(s, player, move.lineIndex, r);
      const b = rollDie(rng);
      s = greedyBonusPlace(s, player, b, rng);
      s = endTurn(s);
    } else {
      s = endTurn(placeDie(s, player, move.lineIndex, { value: r, shield: false }));
    }
    depth++;
  }
  return outcomeValue(gameResult(s));
}

export function montecarloValue(state, n, rng, opts = {}) {
  let total = 0;
  for (let k = 0; k < n; k++) total += rollout(state, rng, opts);
  return total / n;
}

export function mcMyPlacementValue(state, lineIndex, value, n, rng, opts = {}) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    let total = 0;
    for (let k = 0; k < n; k++) {
      let s1 = resolveAlkkagi(state, 'me', lineIndex, value);
      const b = rollDie(rng);
      s1 = greedyBonusPlace(s1, 'me', b, rng);
      total += rollout(endTurn(s1), rng, opts);
    }
    return total / n;
  }
  const s = endTurn(placeDie(state, 'me', lineIndex, { value, shield: false }));
  return montecarloValue(s, n, rng, opts);
}

export function mcBonusPlacementValue(state, target, value, n, rng, opts = {}) {
  const s = endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true }));
  return montecarloValue(s, n, rng, opts);
}

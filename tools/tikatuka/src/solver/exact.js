import { boardFull, remainingEmpty } from '../state.js';
import { gameResult, outcomeValue, lineResult } from '../scoring.js';
import {
  legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn, setMitjang,
} from '../rules.js';
import { heuristicValue } from './evaluate.js';

export function defaultBudget(state) {
  return Math.min(remainingEmpty(state) + 2, 14);
}

// 완전탐색 작업량 상한: 알까기(칸 되비움)+밑장빼기(×11 분기)가 겹치면 경우의 수가
// 폭발하므로, 노드 수가 한도를 넘으면 중단(throw)하고 호출측이 몬테카를로로 폴백한다.
let nodeCount = 0;
const NODE_LIMIT = 200000;
export function resetExactBudget() { nodeCount = 0; }
class ExactBudgetError extends Error {}
export function isExactBudgetError(e) { return e instanceof ExactBudgetError; }

// 양쪽 라인이 모두 완성된 라인 결과를 바탕으로 이미 승부가 결정됐는지 확인
function gameDecided(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    if (state.me.lines[i].length === 3 && state.opp.lines[i].length === 3) {
      const r = lineResult(state.me.lines[i], state.opp.lines[i]);
      if (r === 'me') me++;
      else if (r === 'opp') opp++;
    }
  }
  if (me >= 2) return 1;
  if (opp >= 2) return 0;
  return null;
}

export function searchValue(state, budget) {
  if (++nodeCount > NODE_LIMIT) throw new ExactBudgetError('EXACT_BUDGET');
  if (boardFull(state)) return outcomeValue(gameResult(state));
  const decided = gameDecided(state);
  if (decided !== null) return decided;
  if (budget <= 0) return heuristicValue(state);
  const player = state.turn;
  // 상대가 먼저 꽉 차도 게임은 판 전체가 찰 때까지 계속된다("game ends when full").
  // 둘 곳 없는 플레이어는 턴만 넘기고, 아직 빈칸이 있는 플레이어가 계속 둔다.
  if (legalLines(state, player).length === 0) return searchValue(endTurn(state), budget);
  let acc = 0;
  for (let r = 1; r <= 6; r++) acc += turnValueExact(state, player, r, budget) / 6;
  return acc;
}

function turnValueExact(state, player, r, budget) {
  const agg = player === 'me' ? Math.max : Math.min;
  const noMit = bestPlacementExact(state, player, r, budget);
  if (!state[player].hasMitjang) return noMit;
  const consumed = setMitjang(state, player, false);
  const vR = bestPlacementExact(consumed, player, r, budget);
  let acc = 0;
  let count = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === r) continue;
    const vR2 = bestPlacementExact(consumed, player, r2, budget);
    acc += agg(vR, vR2);
    count++;
  }
  return agg(noMit, acc / count);
}

function bestPlacementExact(state, player, value, budget) {
  const lines = legalLines(state, player);
  if (lines.length === 0) return heuristicValue(state);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const L of lines) {
    let v;
    if (wouldTriggerAlkkagi(state, player, L, value)) {
      const s1 = resolveAlkkagi(state, player, L, value);
      let bAcc = 0;
      for (let b = 1; b <= 6; b++) bAcc += bonusValueExact(s1, player, b, budget) / 6;
      v = bAcc;
    } else {
      v = searchValue(endTurn(placeDie(state, player, L, { value, shield: false })), budget - 1);
    }
    result = agg(result, v);
  }
  return result;
}

function bonusValueExact(state, player, b, budget) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return searchValue(endTurn(state), budget - 1);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const t of targets) {
    const s = endTurn(placeDie(state, t.side, t.lineIndex, { value: b, shield: true }));
    result = agg(result, searchValue(s, budget - 1));
  }
  return result;
}

export function exactMyPlacementValue(state, lineIndex, value, budget = defaultBudget(state)) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    const s1 = resolveAlkkagi(state, 'me', lineIndex, value);
    let acc = 0;
    for (let b = 1; b <= 6; b++) acc += bonusValueExact(s1, 'me', b, budget) / 6;
    return acc;
  }
  return searchValue(endTurn(placeDie(state, 'me', lineIndex, { value, shield: false })), budget - 1);
}

export function exactBonusPlacementValue(state, target, value, budget = defaultBudget(state)) {
  return searchValue(endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true })), budget - 1);
}

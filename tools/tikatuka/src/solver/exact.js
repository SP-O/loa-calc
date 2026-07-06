import { boardFull, remainingEmpty, opponentOf } from '../state.js';
import { gameResult, outcomeValue, lineResult } from '../scoring.js';
import {
  legalLines, emptyTargets, wouldTriggerAlkkagi,
} from '../rules.js';
import { heuristicValue } from './evaluate.js';

// ── 구조 공유 자식상태 생성 ──
// rules.js의 placeDie/endTurn은 cloneState(전체 깊은 복사)라 탐색 핫패스에서 지배적 비용.
// 탐색은 상태를 제자리 수정하지 않으므로, 바뀐 라인 배열만 새로 만들고 나머지는 공유해도 안전.
function withLines(state, player, lines, turn) {
  const side = { lines, hasMitjang: state[player].hasMitjang };
  return player === 'me'
    ? { me: side, opp: state.opp, turn }
    : { me: state.me, opp: side, turn };
}

function placedChild(state, player, L, value, shield, turn) {
  const lines = state[player].lines.slice();
  lines[L] = [...lines[L], { value, shield }];
  return withLines(state, player, lines, turn);
}

function alkkagiChild(state, player, L, value) {
  const opp = opponentOf(player);
  const lines = state[opp].lines.slice();
  lines[L] = lines[L].filter((d) => !(d.value === value && !d.shield));
  return withLines(state, opp, lines, state.turn);
}

function mitjangConsumedChild(state, player) {
  const side = { lines: state[player].lines, hasMitjang: false };
  return player === 'me'
    ? { me: side, opp: state.opp, turn: state.turn }
    : { me: state.me, opp: side, turn: state.turn };
}

function turnChild(state, turn) {
  return { me: state.me, opp: state.opp, turn };
}

export function defaultBudget(state) {
  return Math.min(remainingEmpty(state) + 2, 14);
}

// 완전탐색 작업량 상한: 알까기(칸 되비움)+밑장빼기(×11 분기)가 겹치면 경우의 수가
// 폭발하므로, 노드 수가 한도를 넘으면 중단(throw)하고 호출측이 몬테카를로로 폴백한다.
let nodeCount = 0;
const NODE_LIMIT = 200000;
// 트랜스포지션 테이블: 주사위 순서만 다른 동일 국면이 대량 반복되므로
// (라인은 순서 무관 멀티셋) 캐시로 지수적 중복을 제거한다. recommend 1회 단위로 리셋.
let memo = new Map();
// 노드 한도와 별개로 벽시계 상한도 둔다: 초과 시 동일하게 MC 폴백되므로 응답성이 보장된다.
// 리롤이 남은 엔드게임은 분기(×11)가 커서 대부분 완주 불가 → 일반 모드는 짧게 포기하고
// (MC도 순위는 정확) 정밀 모드만 길게 시도해 정확해를 얻는다. (전개 1024개마다만 시계 확인)
let deadline = Infinity;
export function resetExactBudget(timeLimitMs = 2500) {
  nodeCount = 0; memo = new Map(); deadline = Date.now() + timeLimitMs;
}
class ExactBudgetError extends Error {}
export function isExactBudgetError(e) { return e instanceof ExactBudgetError; }

// 주사위 심볼: value 1..6, 실드면 +6 (7..12), 빈칸 0. 라인은 순서 무관 멀티셋이므로
// 내림차순 정렬해 13진수 3자리로 팩(<2197 < 2^12). 상태 전체 = 숫자 2개(2단 Map 키).
function lineCode(l) {
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < l.length; i++) {
    const d = l[i];
    const v = d.shield ? d.value + 6 : d.value;
    if (v > a) { c = b; b = a; a = v; }
    else if (v > b) { c = b; b = v; }
    else if (v > c) { c = v; }
  }
  return (a * 13 + b) * 13 + c;
}

function keyMe(state) { // 내 라인 3개 → 36비트
  const m = state.me.lines;
  return (lineCode(m[0]) * 4096 + lineCode(m[1])) * 4096 + lineCode(m[2]);
}

function keyOppFlags(state, budget) { // 상대 라인 3개 + 턴·밑장·예산 → 43비트
  const o = state.opp.lines;
  const flags = budget * 8 + (state.turn === 'me' ? 4 : 0)
    + (state.me.hasMitjang ? 2 : 0) + (state.opp.hasMitjang ? 1 : 0);
  return ((lineCode(o[0]) * 4096 + lineCode(o[1])) * 4096 + lineCode(o[2])) * 128 + flags;
}

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

export function exactNodeCount() { return nodeCount; } // 진단·테스트용

export function searchValue(state, budget) {
  const k1 = keyMe(state);
  let inner = memo.get(k1);
  if (inner === undefined) { inner = new Map(); memo.set(k1, inner); }
  const k2 = keyOppFlags(state, budget);
  const hit = inner.get(k2);
  if (hit !== undefined) return hit;
  const v = computeValue(state, budget);
  inner.set(k2, v); // 말단(승부 확정·휴리스틱 잎)도 캐시 — 잎이 호출의 대부분
  return v;
}

function computeValue(state, budget) {
  if (boardFull(state)) return outcomeValue(gameResult(state));
  const decided = gameDecided(state);
  if (decided !== null) return decided;
  if (budget <= 0) return heuristicValue(state);
  const player = state.turn;
  // 상대가 먼저 꽉 차도 게임은 판 전체가 찰 때까지 계속된다("game ends when full").
  // 둘 곳 없는 플레이어는 턴만 넘기고, 아직 빈칸이 있는 플레이어가 계속 둔다.
  if (legalLines(state, player).length === 0) return searchValue(turnChild(state, opponentOf(player)), budget);
  // 한도는 실제 전개(캐시 미스)만 센다 — 히트·말단은 사실상 공짜라 작업량이 아니다.
  if (++nodeCount > NODE_LIMIT) throw new ExactBudgetError('EXACT_BUDGET');
  if ((nodeCount & 1023) === 0 && Date.now() > deadline) throw new ExactBudgetError('EXACT_BUDGET');
  let acc = 0;
  for (let r = 1; r <= 6; r++) acc += turnValueExact(state, player, r, budget) / 6;
  return acc;
}

function turnValueExact(state, player, r, budget) {
  const agg = player === 'me' ? Math.max : Math.min;
  const noMit = bestPlacementExact(state, player, r, budget);
  if (!state[player].hasMitjang) return noMit;
  const consumed = mitjangConsumedChild(state, player);
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
      const s1 = alkkagiChild(state, player, L, value);
      let bAcc = 0;
      for (let b = 1; b <= 6; b++) bAcc += bonusValueExact(s1, player, b, budget) / 6;
      v = bAcc;
    } else {
      v = searchValue(placedChild(state, player, L, value, false, opponentOf(player)), budget - 1);
    }
    result = agg(result, v);
  }
  return result;
}

function bonusValueExact(state, player, b, budget) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return searchValue(turnChild(state, opponentOf(player)), budget - 1);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const t of targets) {
    const s = placedChild(state, t.side, t.lineIndex, b, true, opponentOf(player));
    result = agg(result, searchValue(s, budget - 1));
  }
  return result;
}

export function exactMyPlacementValue(state, lineIndex, value, budget = defaultBudget(state)) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    const s1 = alkkagiChild(state, 'me', lineIndex, value);
    let acc = 0;
    for (let b = 1; b <= 6; b++) acc += bonusValueExact(s1, 'me', b, budget) / 6;
    return acc;
  }
  return searchValue(placedChild(state, 'me', lineIndex, value, false, 'opp'), budget - 1);
}

export function exactBonusPlacementValue(state, target, value, budget = defaultBudget(state)) {
  return searchValue(placedChild(state, target.side, target.lineIndex, value, true, 'opp'), budget - 1);
}

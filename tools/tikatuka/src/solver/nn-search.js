// 신경망 가치를 리프 평가로 쓰는 깊이 제한 expectiminimax(주사위는 샘플링).
// 구조는 검증된 exact.js를 그대로 따른다: me 노드 max, opp 노드 min, 주사위 chance 평균.
// self-play(executeTurn)와 브라우저 추천(nnRecommend)에서 공용.

import { boardFull } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import {
  legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn, setMitjang,
} from '../rules.js';
import { encode } from './encode.js';
import { predict } from './net.js';
import { rollDie } from './evaluate.js';

export function leafValue(net, state) {
  return predict(net, encode(state)); // me 관점 승률 0~1
}

function diceOutcomes(rng, samples) {
  if (samples >= 6) {
    const o = [];
    for (let r = 1; r <= 6; r++) o.push({ r, w: 1 / 6 });
    return o;
  }
  const o = [];
  for (let k = 0; k < samples; k++) o.push({ r: rollDie(rng), w: 1 / samples });
  return o;
}

export function stateValue(net, state, depth, samples, rng) {
  if (boardFull(state)) return outcomeValue(gameResult(state));
  if (depth <= 0) return leafValue(net, state);
  const player = state.turn;
  let acc = 0;
  for (const { r, w } of diceOutcomes(rng, samples)) acc += w * turnValue(net, state, player, r, depth, samples, rng);
  return acc;
}

function turnValue(net, state, player, r, depth, samples, rng) {
  const agg = player === 'me' ? Math.max : Math.min;
  const noMit = bestPlacement(net, state, player, r, depth, samples, rng);
  if (!state[player].hasMitjang) return noMit;
  const consumed = setMitjang(state, player, false);
  const vR = bestPlacement(net, consumed, player, r, depth, samples, rng);
  let acc = 0; let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === r) continue;
    acc += agg(vR, bestPlacement(net, consumed, player, r2, depth, samples, rng));
    n++;
  }
  return agg(noMit, acc / n);
}

function bestPlacement(net, state, player, value, depth, samples, rng) {
  const lines = legalLines(state, player);
  if (lines.length === 0) return leafValue(net, state);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const L of lines) {
    result = agg(result, placementValue(net, state, player, L, value, depth, samples, rng));
  }
  return result;
}

function placementValue(net, state, player, L, value, depth, samples, rng) {
  if (wouldTriggerAlkkagi(state, player, L, value)) {
    const s1 = resolveAlkkagi(state, player, L, value);
    let acc = 0;
    for (const { r: b, w } of diceOutcomes(rng, samples)) acc += w * bonusValue(net, s1, player, b, depth, samples, rng);
    return acc;
  }
  return stateValue(net, endTurn(placeDie(state, player, L, { value, shield: false })), depth - 1, samples, rng);
}

function bonusValue(net, state, player, b, depth, samples, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return stateValue(net, endTurn(state), depth - 1, samples, rng);
  const agg = player === 'me' ? Math.max : Math.min;
  let result = player === 'me' ? -Infinity : Infinity;
  for (const t of targets) {
    const s = endTurn(placeDie(state, t.side, t.lineIndex, { value: b, shield: true }));
    result = agg(result, stateValue(net, s, depth - 1, samples, rng));
  }
  return result;
}

// --- 행동 선택/실행 (self-play & 추천 공용) ---

function actionValues(net, state, player, value, depth, samples, rng) {
  const out = [];
  for (const L of legalLines(state, player)) {
    out.push({
      target: { side: player, lineIndex: L },
      alkkagi: wouldTriggerAlkkagi(state, player, L, value),
      winProb: placementValue(net, state, player, L, value, depth, samples, rng),
    });
  }
  return out;
}

function pick(avs, player, rng, temperature) {
  if (!temperature || temperature <= 0) {
    let best = avs[0];
    for (const a of avs) if (player === 'me' ? a.winProb > best.winProb : a.winProb < best.winProb) best = a;
    return best;
  }
  const sign = player === 'me' ? 1 : -1;
  const ws = avs.map((a) => Math.exp((sign * a.winProb) / temperature));
  const sum = ws.reduce((s, x) => s + x, 0);
  let rr = rng() * sum;
  for (let i = 0; i < avs.length; i++) { rr -= ws[i]; if (rr <= 0) return avs[i]; }
  return avs[avs.length - 1];
}

function bestBonusTarget(net, state, player, b, depth, samples, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return null;
  let best = null;
  let bestScore = player === 'me' ? -Infinity : Infinity;
  for (const t of targets) {
    const v = stateValue(net, endTurn(placeDie(state, t.side, t.lineIndex, { value: b, shield: true })), depth - 1, samples, rng);
    if (player === 'me' ? v > bestScore : v < bestScore) { bestScore = v; best = t; }
  }
  return best;
}

function rerollDie(rng, exclude) {
  let v = rollDie(rng);
  while (v === exclude) v = rollDie(rng);
  return v;
}

// 한 턴 진행(현재 mover 기준): 굴림→(밑장빼기)→배치→(알까기+보너스)→endTurn. 다음 상태 반환.
export function executeTurn(net, state, rng, opts = {}, isFirstDie = false) {
  const depth = opts.depth ?? 1;
  const samples = opts.samples ?? 3;
  const temperature = opts.temperature ?? 0;
  const player = state.turn;
  const agg = player === 'me' ? Math.max : Math.min;

  // 내 필드에 빈칸이 전혀 없으면(상대 보너스로 꽉 찬 경우 등) 놓을 수 없으니 턴 스킵
  if (legalLines(state, player).length === 0) return endTurn(state);

  let cur = state;
  let value = rollDie(rng);

  // 밑장빼기(있으면): 사용 가치 vs 보유 가치 비교(단순)
  if (cur[player].hasMitjang) {
    const keepVal = bestPlacement(net, cur, player, value, depth, samples, rng);
    const consumed = setMitjang(cur, player, false);
    let useAcc = 0; let n = 0;
    const vR = bestPlacement(net, consumed, player, value, depth, samples, rng);
    for (let r2 = 1; r2 <= 6; r2++) {
      if (r2 === value) continue;
      useAcc += agg(vR, bestPlacement(net, consumed, player, r2, depth, samples, rng));
      n++;
    }
    const useVal = useAcc / n;
    const wantsUse = player === 'me' ? useVal > keepVal + 0.02 : useVal < keepVal - 0.02;
    if (wantsUse) {
      cur = consumed;
      const r2 = rerollDie(rng, value);
      const vKeep = bestPlacement(net, cur, player, value, depth, samples, rng);
      const vNew = bestPlacement(net, cur, player, r2, depth, samples, rng);
      value = (player === 'me' ? vNew > vKeep : vNew < vKeep) ? r2 : value;
    }
  }

  const avs = actionValues(net, cur, player, value, depth, samples, rng);
  const choice = pick(avs, player, rng, temperature);
  const L = choice.target.lineIndex;

  if (choice.alkkagi) {
    const s1 = resolveAlkkagi(cur, player, L, value);
    const b = rollDie(rng);
    const t = bestBonusTarget(net, s1, player, b, depth, samples, rng);
    const s2 = t ? placeDie(s1, t.side, t.lineIndex, { value: b, shield: true }) : s1;
    return endTurn(s2);
  }
  return endTurn(placeDie(cur, player, L, { value, shield: isFirstDie }));
}

// 브라우저 추천(me 관점). recommend()와 동일한 반환 형태.
export function nnRecommend(net, state, die, opts = {}) {
  const depth = opts.depth ?? 1;
  const samples = opts.samples ?? 6;
  const rng = opts.rng;
  const isBonus = !!opts.isBonus;

  let options;
  if (isBonus) {
    options = emptyTargets(state).map((t) => ({
      target: t,
      alkkagi: false,
      winProb: stateValue(net, endTurn(placeDie(state, t.side, t.lineIndex, { value: die, shield: true })), depth - 1, samples, rng),
    }));
  } else {
    options = actionValues(net, state, 'me', die, depth, samples, rng);
  }
  options.sort((a, b) => b.winProb - a.winProb);
  const best = options[0] ?? null;

  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && best) {
    const baseWinProb = best.winProb;
    const consumed = setMitjang(state, 'me', false);
    const vDie = Math.max(...actionValues(net, consumed, 'me', die, depth, samples, rng).map((a) => a.winProb), 0);
    let acc = 0; let n = 0;
    for (let r2 = 1; r2 <= 6; r2++) {
      if (r2 === die) continue;
      const vR2 = Math.max(...actionValues(net, consumed, 'me', r2, depth, samples, rng).map((a) => a.winProb), 0);
      acc += Math.max(vDie, vR2);
      n++;
    }
    const mitjangWinProb = acc / n;
    mitjang = { recommend: mitjangWinProb > baseWinProb + 0.04, baseWinProb, mitjangWinProb };
  }
  return { options, best, mitjang };
}

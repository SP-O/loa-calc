// 진짜 PUCT MCTS (AlphaZero식). 결정 노드 = {state, phase, die, mover}.
// 주사위는 chance: 행동 후 롤을 샘플링해 자식 결정노드 생성(롤값별 캐시).
// 가치는 me 관점(0~1) 통일: me 노드는 Q 최대화, opp 노드는 (1-Q) 최대화. 종료는 실제 결과.

import { boardFull } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn } from '../rules.js';
import { makeRng, rollDie } from './evaluate.js';
import { azEncode, legalMask, actionToTarget, NUM_ACTIONS } from './az-encode.js';
import { azForward, softmaxMasked } from './az-net.js';

const C_PUCT = 1.5;

// 놓을 곳 없는 mover는 스킵. 둘 곳 있는 mover의 턴 시작 상태 반환, 또는 종료.
function advanceToTurnStart(state) {
  let s = state;
  for (let guard = 0; guard < 6; guard++) {
    if (boardFull(s)) return { terminal: true, value: outcomeValue(gameResult(s)) };
    if (legalLines(s, s.turn).length > 0) return { terminal: false, state: s, phase: 'normal', mover: s.turn };
    s = endTurn(s);
  }
  return { terminal: true, value: outcomeValue(gameResult(s)) };
}

// 결정노드에서 행동 a 적용 → 다음 상태(롤 대기) 또는 종료
function applyAction(state, mover, phase, die, a) {
  if (phase === 'normal') {
    const L = actionToTarget(a).lineIndex; // mover의 라인(a가 me면 0-2, opp면 3-5 → lineIndex 0-2)
    if (wouldTriggerAlkkagi(state, mover, L, die)) {
      const s1 = resolveAlkkagi(state, mover, L, die); // mover 유지
      if (emptyTargets(s1).length === 0) return advanceToTurnStart(endTurn(s1));
      return { terminal: false, state: s1, phase: 'bonus', mover };
    }
    const placed = placeDie(state, mover, L, { value: die, shield: false });
    if (boardFull(placed)) return { terminal: true, value: outcomeValue(gameResult(placed)) };
    return advanceToTurnStart(endTurn(placed));
  }
  // bonus
  const t = actionToTarget(a);
  const placed = placeDie(state, t.side, t.lineIndex, { value: die, shield: true });
  if (boardFull(placed)) return { terminal: true, value: outcomeValue(gameResult(placed)) };
  return advanceToTurnStart(endTurn(placed));
}

function createDecision(state, phase, die, mover) {
  return { state, phase, die, mover, expanded: false };
}

function expand(net, node) {
  const fwd = azForward(net, azEncode(node.state, node.phase, node.die));
  node.mask = legalMask(node.state, node.phase, node.mover);
  node.P = softmaxMasked(fwd.policyLogits, node.mask);
  node.value = fwd.value;
  node.N = 0;
  node.edgeN = new Array(NUM_ACTIONS).fill(0);
  node.edgeW = new Array(NUM_ACTIONS).fill(0);
  node.succ = new Array(NUM_ACTIONS).fill(null);
  node.children = Array.from({ length: NUM_ACTIONS }, () => new Map());
  node.expanded = true;
  return fwd.value;
}

function selectAction(node) {
  const sqrtN = Math.sqrt(node.N + 1e-8);
  let best = -1;
  let bestScore = -Infinity;
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (!node.mask[a]) continue;
    const n = node.edgeN[a];
    const q = n > 0 ? node.edgeW[a] / n : 0.5; // me 관점
    const moverQ = node.mover === 'me' ? q : 1 - q;
    const u = (C_PUCT * node.P[a] * sqrtN) / (1 + n);
    const score = moverQ + u;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

function simulate(net, node, rng) {
  if (!node.expanded) return expand(net, node);
  const a = selectAction(node);
  if (node.succ[a] === null) node.succ[a] = applyAction(node.state, node.mover, node.phase, node.die, a);
  const succ = node.succ[a];
  let v;
  if (succ.terminal) {
    v = succ.value;
  } else {
    const r = rollDie(rng);
    let child = node.children[a].get(r);
    if (!child) {
      child = createDecision(succ.state, succ.phase, r, succ.mover);
      node.children[a].set(r, child);
    }
    v = simulate(net, child, rng);
  }
  node.edgeN[a] += 1;
  node.edgeW[a] += v;
  node.N += 1;
  return v;
}

// 루트 탐험 노이즈(균등 혼합): self-play 전용
function addExplorationNoise(node, eps) {
  const legal = [];
  for (let a = 0; a < NUM_ACTIONS; a++) if (node.mask[a]) legal.push(a);
  if (legal.length === 0) return;
  const u = 1 / legal.length;
  for (const a of legal) node.P[a] = (1 - eps) * node.P[a] + eps * u;
}

// 방문수 기반 정책(학습 타깃용), 길이 NUM_ACTIONS
export function visitPolicy(root) {
  const pol = new Array(NUM_ACTIONS).fill(0);
  let total = 0;
  for (let a = 0; a < NUM_ACTIONS; a++) total += root.edgeN[a];
  if (total === 0) return root.mask ? root.mask.map((m) => 0) : pol;
  for (let a = 0; a < NUM_ACTIONS; a++) pol[a] = root.edgeN[a] / total;
  return pol;
}

// 방문수^(1/temp)에 비례해 행동 샘플(legal만). temp→0이면 최다 방문 선택.
export function sampleActionByVisits(root, temperature, rng) {
  const legal = [];
  for (let a = 0; a < NUM_ACTIONS; a++) if (root.mask[a]) legal.push(a);
  if (temperature <= 1e-6) {
    let best = legal[0];
    for (const a of legal) if (root.edgeN[a] > root.edgeN[best]) best = a;
    return best;
  }
  const ws = legal.map((a) => Math.pow(root.edgeN[a] + 1e-9, 1 / temperature));
  const sum = ws.reduce((s, x) => s + x, 0) || 1;
  let rr = rng() * sum;
  for (let k = 0; k < legal.length; k++) { rr -= ws[k]; if (rr <= 0) return legal[k]; }
  return legal[legal.length - 1];
}

export function mctsSearch(net, state, phase, die, opts = {}) {
  const sims = opts.sims ?? 200;
  const rng = opts.rng ?? makeRng(opts.seed ?? 12345);
  const root = createDecision(state, phase, die, opts.mover ?? 'me');
  expand(net, root);
  if (opts.noiseEps) addExplorationNoise(root, opts.noiseEps);
  for (let i = 0; i < sims; i++) simulate(net, root, rng);

  const options = [];
  for (let a = 0; a < NUM_ACTIONS; a++) {
    if (!root.mask[a]) continue;
    const n = root.edgeN[a];
    options.push({
      target: actionToTarget(a),
      visits: n,
      winProb: n > 0 ? root.edgeW[a] / n : root.value,
      alkkagi: phase === 'normal' && wouldTriggerAlkkagi(state, root.mover, actionToTarget(a).lineIndex, die),
    });
  }
  options.sort((x, y) => y.visits - x.visits);
  return { root, options, best: options[0] ?? null };
}

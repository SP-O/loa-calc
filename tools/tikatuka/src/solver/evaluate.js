import { lineSum } from '../scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie } from '../rules.js';

const HEUR_K = 7;

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

// 밑장빼기 새 주사위: 게임 규칙상 원래 값은 절대 안 나온다 — 나머지 5개 값 균등.
export function rerollDie(rng, exclude) {
  const v = 1 + Math.floor(rng() * 5);
  return v >= exclude ? v + 1 : v;
}

export function pAtLeastTwo(a, b, c) {
  return a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c + a * b * c;
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function removableValue(line) {
  // 한 번의 알까기로 제거 가능한 최대 점수 기여(비실드 같은 값 그룹).
  // 더블6=18 > 더블3=9 > 단일6=6 = 더블2=6 > 단일3=3 ... (프로 우선순위 반영)
  const counts = {};
  for (const d of line) if (!d.shield) counts[d.value] = (counts[d.value] || 0) + 1;
  let best = 0;
  for (const v in counts) {
    const c = counts[v];
    const val = Number(v);
    const contrib = c === 1 ? val : c === 2 ? 3 * val : 5 * val;
    if (contrib > best) best = contrib;
  }
  return best;
}

export function lineWinProb(state, i) {
  const myLine = state.me.lines[i];
  const opLine = state.opp.lines[i];
  const my = lineSum(myLine);
  const op = lineSum(opLine);
  const myFull = myLine.length === 3;
  const opFull = opLine.length === 3;
  // 잠긴 라인: 합은 놓을수록 늘기만 하고, 알까기는 "그 라인의 자기 줄에 빈칸"이 있어야
  // 시전 가능하다. → 상대 줄이 풀이면 상대는 그 라인에서 아무것도 못 한다(못 채우고 못 뜯음).
  if (myFull && opFull) return my > op ? 0.98 : my < op ? 0.02 : 0.5;
  if (opFull && my >= op) return 0.98; // 내 줄만 열림: 채우면 늘기만 하고 뜯길 수 없음 → 영구 우세
  if (myFull && my <= op) return 0.02; // 상대 줄만 열림: 내 합은 굳고 상대는 커지기만 함 → 영구 열세
  let margin = my - op;
  // 상대에서 알까기로 뜯어낼 수 있는 가치(높을수록 유리) — 내 줄에 빈칸이 있어야 시전 가능
  if (!myFull) margin += removableValue(opLine) * 0.25;
  // 상대가 나에게서 뜯어낼 수 있는 가치(불리, 실드 제외) — 상대 줄에 빈칸이 있어야 가능
  if (!opFull) margin -= removableValue(myLine) * 0.18;
  return clamp(1 / (1 + Math.exp(-margin / HEUR_K)), 0.02, 0.98);
}

export function heuristicValue(state) {
  const p = [0, 1, 2].map((i) => lineWinProb(state, i));
  return pAtLeastTwo(p[0], p[1], p[2]);
}

export function chooseScore(player, state) {
  const h = heuristicValue(state);
  return player === 'me' ? h : 1 - h;
}

// 후보 평가는 보드 전체 복제(cloneState) 대신 "제자리 수정 후 원복"으로 한다(핫패스).
// 평가 함수(chooseScore)는 동기·순수라 원복이 보장되고, 호출자 상태는 밖에서 볼 때 불변.
export function greedyMoveScored(state, value, rng) {
  const player = state.turn;
  const opp = player === 'me' ? 'opp' : 'me';
  const lines = legalLines(state, player);
  if (lines.length === 0) return null;
  // 자해 알까기: 이미 이기고 있는 줄을 알까기로 '열어주면' 상대가 빈 슬롯을 되채워
  // 역전할 수 있다(잠긴 승리를 헌납하는 그리디 실수). 다른 둘 곳이 있으면 그런 알까기는 거른다.
  const selfDefeating = (L) =>
    wouldTriggerAlkkagi(state, player, L, value) &&
    lineSum(state[player].lines[L]) > lineSum(state[opp].lines[L]);
  let pool = lines.filter((L) => !selfDefeating(L));
  if (pool.length === 0) pool = lines; // 모든 줄이 자해뿐이면 어쩔 수 없이 원래대로
  let best = null;
  let bestScore = -Infinity;
  for (const L of pool) {
    const alkkagi = wouldTriggerAlkkagi(state, player, L, value);
    let sc;
    if (alkkagi) {
      const oline = state[opp].lines[L];
      state[opp].lines[L] = oline.filter((d) => !(d.value === value && !d.shield));
      sc = chooseScore(player, state) + rng() * 1e-6; // 동점 시 미세 난수
      state[opp].lines[L] = oline;
    } else {
      const mline = state[player].lines[L];
      mline.push({ value, shield: false });
      sc = chooseScore(player, state) + rng() * 1e-6;
      mline.pop();
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = { lineIndex: L, alkkagi };
    }
  }
  return best && { move: best, score: bestScore };
}

export function greedyMove(state, value, rng) {
  const scored = greedyMoveScored(state, value, rng);
  return scored && scored.move;
}

// 실제 인게임 AI를 흉내낸 상대 정책(B-lite): 알까기 가능하면 우선(제거가치 큰 것),
// 그다음 "2칸 라인 회피"(0/1칸 우선), 마지막으로 자기 점수 최대화 greedy.
export function aiOpponentMove(state, value, rng) {
  const player = state.turn;
  const lines = legalLines(state, player);
  if (lines.length === 0) return null;
  const opp = player === 'me' ? 'opp' : 'me';

  // 1) 알까기 우선
  let bestAlk = -1;
  let bestAlkVal = -1;
  for (const L of lines) {
    if (!wouldTriggerAlkkagi(state, player, L, value)) continue;
    const c = state[opp].lines[L].filter((d) => d.value === value && !d.shield).length;
    const removed = c === 1 ? value : c === 2 ? 3 * value : 5 * value;
    if (removed > bestAlkVal) { bestAlkVal = removed; bestAlk = L; }
  }
  if (bestAlk >= 0) return { lineIndex: bestAlk, alkkagi: true };

  // 2) 2칸 라인 회피 → 3) 그 중 자기 점수 최대
  const pool = lines.filter((L) => state[player].lines[L].length < 2);
  const cand = pool.length ? pool : lines;
  let best = cand[0];
  let bestScore = -Infinity;
  for (const L of cand) {
    const mline = state[player].lines[L];
    mline.push({ value, shield: false });
    const sc = chooseScore(player, state) + rng() * 1e-6;
    mline.pop();
    if (sc > bestScore) { bestScore = sc; best = L; }
  }
  return { lineIndex: best, alkkagi: false };
}

// 보너스 주사위 최적 배치 칸 선택(점수 평가는 제자리 수정 후 원복 — 상태 불변).
export function greedyBonusTarget(state, player, b, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const t of targets) {
    const line = state[t.side].lines[t.lineIndex];
    line.push({ value: b, shield: true });
    const sc = chooseScore(player, state) + rng() * 1e-6;
    line.pop();
    if (sc > bestScore) {
      bestScore = sc;
      best = t;
    }
  }
  return best;
}

export function greedyBonusPlace(state, player, b, rng) {
  const t = greedyBonusTarget(state, player, b, rng);
  return t ? placeDie(state, t.side, t.lineIndex, { value: b, shield: true }) : state;
}

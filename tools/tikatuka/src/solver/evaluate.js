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
  const my = lineSum(state.me.lines[i]);
  const op = lineSum(state.opp.lines[i]);
  let margin = my - op;
  // 상대에서 알까기로 뜯어낼 수 있는 가치(높을수록 유리) — 고점 더블/트리플일수록 큼
  margin += removableValue(state.opp.lines[i]) * 0.25;
  // 상대가 나에게서 뜯어낼 수 있는 가치(불리). 실드는 제외(못 뜯김)
  margin -= removableValue(state.me.lines[i]) * 0.18;
  // 양쪽 라인 꽉 찼고 내가 뒤지면 굳어진 패배 → 추가 페널티
  if (state.me.lines[i].length === 3 && state.opp.lines[i].length === 3 && margin < 0) margin -= 2;
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

export function greedyMove(state, value, rng) {
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
    const next = alkkagi
      ? resolveAlkkagi(state, player, L, value)
      : placeDie(state, player, L, { value, shield: false });
    const sc = chooseScore(player, next) + rng() * 1e-6; // 동점 시 미세 난수
    if (sc > bestScore) {
      bestScore = sc;
      best = { lineIndex: L, alkkagi };
    }
  }
  return best;
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
    const next = placeDie(state, player, L, { value, shield: false });
    const sc = chooseScore(player, next) + rng() * 1e-6;
    if (sc > bestScore) { bestScore = sc; best = L; }
  }
  return { lineIndex: best, alkkagi: false };
}

export function greedyBonusPlace(state, player, b, rng) {
  const targets = emptyTargets(state);
  if (targets.length === 0) return state;
  let best = state;
  let bestScore = -Infinity;
  for (const t of targets) {
    const next = placeDie(state, t.side, t.lineIndex, { value: b, shield: true });
    const sc = chooseScore(player, next) + rng() * 1e-6;
    if (sc > bestScore) {
      bestScore = sc;
      best = next;
    }
  }
  return best;
}

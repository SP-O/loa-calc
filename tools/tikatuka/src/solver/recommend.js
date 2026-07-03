import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import {
  exactMyPlacementValue, exactBonusPlacementValue, defaultBudget,
  resetExactBudget, isExactBudgetError,
} from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 700;
// 정밀 모드: 완전탐색 범위·롤아웃을 키워 수학적 최적에 더 근접(느림). 무한로딩은 상한+폴백으로 방지.
const EXACT_THRESHOLD_PRECISE = 6;
const MC_ROLLOUTS_PRECISE = 2500;
// 밑장빼기는 게임당 1회뿐인 귀한 자원(타짜의 손놀림). 다시 굴리면 거의 항상 살짝 이득으로
// 보이므로 낮은 임계는 남발을 부른다. "진짜 아껴 쓴 보람"이 있는 큰 이득(11%p 이상)일 때만 권장.
// (무작위 보드 측정: 4%p면 ~46% 발생 → 11%p면 ~14%로 감소.)
const MITJANG_MARGIN = 0.11;
// 밑장빼기 판단은 4%p 임계의 coarse yes/no라 옵션 계산만큼 정밀할 필요가 없다.
// 롤아웃을 줄여 전체 계산의 ~87%를 차지하던 밑장 비용을 크게 절감한다(조언용).
const MITJANG_ROLLOUTS = 300;
const MITJANG_ROLLOUTS_PRECISE = 700;

export function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const baseSeed = opts.seed ?? 1234567;
  const precise = !!opts.precise;
  const realAI = !!opts.realAI; // 실제 AI 상대 모드: 시뮬 상대를 실제 AI처럼 둠(MC)
  const threshold = precise ? EXACT_THRESHOLD_PRECISE : EXACT_THRESHOLD;
  const rollouts = precise ? MC_ROLLOUTS_PRECISE : MC_ROLLOUTS;
  const mitRollouts = precise ? MITJANG_ROLLOUTS_PRECISE : MITJANG_ROLLOUTS;
  const mcOpts = { realAI };
  const budget = defaultBudget(state);
  // 실제 AI 모드는 상대 정책을 반영해야 하므로 완전탐색(최적 상대 가정) 대신 MC 사용
  let exact = !realAI && remainingEmpty(state) <= threshold;

  let built;
  try {
    if (exact) resetExactBudget();
    built = build(state, die, isBonus, exact, budget, baseSeed, rollouts, mcOpts, mitRollouts);
  } catch (e) {
    if (exact && isExactBudgetError(e)) {
      exact = false;
      built = build(state, die, isBonus, false, budget, baseSeed, rollouts, mcOpts, mitRollouts);
    } else {
      throw e;
    }
  }

  const { options, mitjang } = built;
  const best = options[0] ?? null;
  return { options, best, mitjang };
}

function build(state, die, isBonus, exact, budget, baseSeed, rollouts, mcOpts, mitRollouts) {
  const evalMy = (L) =>
    exact
      ? exactMyPlacementValue(state, L, die, budget)
      : mcMyPlacementValue(state, L, die, rollouts, makeRng(baseSeed + 1 + L), mcOpts);
  const evalBonus = (t) =>
    exact
      ? exactBonusPlacementValue(state, t, die, budget)
      : mcBonusPlacementValue(state, t, die, rollouts, makeRng(baseSeed + 20 + (t.side === 'opp' ? 3 : 0) + t.lineIndex), mcOpts);

  const options = [];
  if (isBonus) {
    for (const t of emptyTargets(state)) {
      options.push({ target: t, alkkagi: false, winProb: evalBonus(t) });
    }
  } else {
    for (const L of legalLines(state, 'me')) {
      options.push({
        target: { side: 'me', lineIndex: L },
        alkkagi: wouldTriggerAlkkagi(state, 'me', L, die),
        winProb: evalMy(L),
      });
    }
  }
  options.sort((a, b) => b.winProb - a.winProb);

  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && options[0]) {
    const baseWinProb = options[0].winProb;
    // 밑장 값은 항상 ≤ 1.0. base가 이미 (1 - margin) 이상이면 리롤이 margin만큼 못 넘김
    // → 권장은 확정적으로 false. 무손실 단축(비싼 밑장 계산 생략).
    if (baseWinProb >= 1 - MITJANG_MARGIN) {
      mitjang = { recommend: false, baseWinProb, mitjangWinProb: baseWinProb };
    } else {
      const mr = exact ? rollouts : mitRollouts; // 완전탐색은 rollouts 무의미. MC만 축소 롤아웃.
      const mitjangWinProb = mitjangValue(state, die, exact, budget, baseSeed, mr, mcOpts, baseWinProb);
      mitjang = { recommend: mitjangWinProb > baseWinProb + MITJANG_MARGIN, baseWinProb, mitjangWinProb };
    }
  }
  return { options, mitjang };
}

function bestMyValue(state, value, exact, budget, rng, rollouts, mcOpts) {
  let best = -Infinity;
  for (const L of legalLines(state, 'me')) {
    const wp = exact
      ? exactMyPlacementValue(state, L, value, budget)
      : mcMyPlacementValue(state, L, value, rollouts, rng, mcOpts);
    if (wp > best) best = wp;
  }
  return best === -Infinity ? 0 : best;
}

function mitjangValue(state, die, exact, budget, baseSeed, rollouts, mcOpts, baseBest) {
  const consumed = setMitjang(state, 'me', false);
  // die를 그대로 둘 때의 값. MC 롤아웃은 hasMitjang을 무시하므로 이미 구한 base 최고값과 동일
  // → 재계산 생략. 완전탐색은 hasMitjang(소진 여부)에 값이 달라지므로 재계산.
  const vDie = exact
    ? bestMyValue(consumed, die, true, budget, makeRng(baseSeed + 100 + die), rollouts, mcOpts)
    : baseBest;
  let acc = 0;
  let n = 0;
  for (let r2 = 1; r2 <= 6; r2++) {
    if (r2 === die) continue;
    const vR2 = bestMyValue(consumed, r2, exact, budget, makeRng(baseSeed + 100 + r2), rollouts, mcOpts);
    acc += Math.max(vDie, vR2);
    n++;
  }
  return acc / n;
}

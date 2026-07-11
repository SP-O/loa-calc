import { remainingEmpty, canonicalKey } from '../state.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, setMitjang, placeDie, endTurn, resolveAlkkagi } from '../rules.js';
import { makeRng } from './evaluate.js';
import { mcMyPlacementValue, mcBonusPlacementValue } from './montecarlo.js';
import {
  exactMyPlacementValue, exactBonusPlacementValue, defaultBudget,
  resetExactBudget, isExactBudgetError,
} from './exact.js';

const EXACT_THRESHOLD = 4;
const MC_ROLLOUTS = 1200;
// 정밀 모드: 완전탐색 범위·롤아웃을 키워 수학적 최적에 더 근접(느림). 무한로딩은 상한+폴백으로 방지.
const EXACT_THRESHOLD_PRECISE = 6;
const MC_ROLLOUTS_PRECISE = 4000;
// 밑장빼기 권장 문턱. 과거 11%p는 "롤아웃이 아껴둔 밑장의 미래가치를 못 보는" 편향의
// 보정치였다. 이제 롤아웃이 밑장을 모델링해 유지-vs-리롤 비교가 공정하므로,
// MC 노이즈 가드(이득 추정 sd ~2.5%p의 2σ)만 남긴다. 완전탐색 경로는 노이즈가 없어
// 사실상 "이득이 5%p 넘으면 권장"으로 동작한다.
const MITJANG_MARGIN = 0.05;
// 밑장빼기 판단은 4%p 임계의 coarse yes/no라 옵션 계산만큼 정밀할 필요가 없다.
// 롤아웃을 줄여 전체 계산의 ~87%를 차지하던 밑장 비용을 크게 절감한다(조언용).
const MITJANG_ROLLOUTS = 400;
const MITJANG_ROLLOUTS_PRECISE = 1000;
// 근소차 적응형 재평가: 기본 1200롤아웃의 노이즈(±1.2%p, 페어 비교 ~1.7%p)는 진짜
// 차이가 1%p 미만인 국면에서 1·2위를 뒤집고 3.5%p대 '가짜 격차'로 표시할 수 있다
// (실사례: 보너스 배치에서 진실 0.6%p 차가 3.5%p 역순으로 표시). 1·2위가 이 폭
// 이내면 상위 후보만 고롤아웃으로 다시 계산해 순위·표시값을 확정한다.
// 폭 5%p = 진짜 근소차(≤1%p) + 페어 노이즈 2.5σ(~4%p). 완전탐색 경로는 노이즈가 없어
// 재평가하지 않는다.
const REFINE_MARGIN = 0.05;
const REFINE_ROLLOUTS = 8000;
const REFINE_ROLLOUTS_PRECISE = 16000;
const REFINE_MAX_CANDIDATES = 3;

// 저사양 기기 자동 보정(opts.scale, 0.25~1): 롤아웃 수를 비례 축소하되 품질 하한을 지킨다.
// 하한 아래로는 절대 안 내려가므로 추천이 "빨라진 대신 엉터리"가 되는 일은 없다.
const SCALE_MIN = 0.25;
const FLOOR_ROLLOUTS = 400;
const FLOOR_MITJANG = 150;
const FLOOR_REFINE = 3000;

// 순차 평가기: 이 스레드에서 그대로 계산(노드 테스트·워커 풀 미지원 브라우저용).
// 워커 풀 평가기(mc-pool.js)와 동일한 인터페이스 — pairBase 범위합이 어떤 분할에서도
// 같은 값을 주므로, 어느 평가기를 쓰든 결과는 완전히 동일하다.
export function sequentialEvaluator() {
  return {
    concurrency: 1,
    my: (state, L, die, n, pairBase, mcOpts) =>
      mcMyPlacementValue(state, L, die, n, makeRng(1), { ...mcOpts, pairBase }),
    bonus: (state, t, die, n, pairBase, mcOpts) =>
      mcBonusPlacementValue(state, t, die, n, makeRng(1), { ...mcOpts, pairBase }),
  };
}

// 이번 추천의 예상 총 롤아웃 수(자동 보정의 예산 계획용, 재평가는 발동 가정 상한치).
export function plannedRollouts(state, die, opts = {}) {
  const precise = !!opts.precise;
  const R = precise ? MC_ROLLOUTS_PRECISE : MC_ROLLOUTS;
  const MR = precise ? MITJANG_ROLLOUTS_PRECISE : MITJANG_ROLLOUTS;
  const RR = precise ? REFINE_ROLLOUTS_PRECISE : REFINE_ROLLOUTS;
  const nOpt = opts.isBonus ? emptyTargets(state).length : legalLines(state, 'me').length;
  const mit = !opts.isBonus && state.me.hasMitjang ? 6 * legalLines(state, 'me').length * MR : 0;
  return nOpt * R + mit + 2 * RR;
}

export async function recommend(state, die, opts = {}) {
  const isBonus = !!opts.isBonus;
  const baseSeed = opts.seed ?? 1234567;
  const precise = !!opts.precise;
  const realAI = !!opts.realAI; // 실제 AI 상대 모드: 시뮬 상대를 실제 AI처럼 둠(MC)
  const threshold = precise ? EXACT_THRESHOLD_PRECISE : EXACT_THRESHOLD;
  const scale = Math.min(1, Math.max(SCALE_MIN, opts.scale ?? 1));
  const rollouts = Math.max(FLOOR_ROLLOUTS, Math.round((precise ? MC_ROLLOUTS_PRECISE : MC_ROLLOUTS) * scale));
  const mitRollouts = Math.max(FLOOR_MITJANG, Math.round((precise ? MITJANG_ROLLOUTS_PRECISE : MITJANG_ROLLOUTS) * scale));
  const refineRollouts = Math.max(FLOOR_REFINE, Math.round((precise ? REFINE_ROLLOUTS_PRECISE : REFINE_ROLLOUTS) * scale));
  const mcOpts = { realAI };
  const ev = opts.evaluator ?? sequentialEvaluator();
  const budget = defaultBudget(state);
  // 실제 AI 모드는 상대 정책을 반영해야 하므로 완전탐색(최적 상대 가정) 대신 MC 사용
  let exact = !realAI && remainingEmpty(state) <= threshold;

  let built;
  try {
    // 일반 모드는 1초만 완전탐색 시도(못 풀면 MC로 신속 폴백), 정밀 모드는 2.5초까지.
    // opts.exactTimeMs: 테스트 등에서 벽시계 상한 재정의(병렬 부하 플레이크 방지).
    if (exact) resetExactBudget(opts.exactTimeMs ?? (precise ? 2500 : 1000));
    built = await build(state, die, isBonus, exact, budget, baseSeed, rollouts, mcOpts, mitRollouts, refineRollouts, ev);
  } catch (e) {
    if (exact && isExactBudgetError(e)) {
      exact = false;
      built = await build(state, die, isBonus, false, budget, baseSeed, rollouts, mcOpts, mitRollouts, refineRollouts, ev);
    } else {
      throw e;
    }
  }

  const { options, mitjang } = built;
  const best = options[0] ?? null;
  return { options, best, mitjang };
}

async function build(state, die, isBonus, exact, budget, baseSeed, rollouts, mcOpts, mitRollouts, refineRollouts, ev) {
  // 대칭 수 통합: 결과 국면의 정준 키가 같은 옵션(예: 빈 보드 첫 수의 세 라인)은
  // 게임 가치가 동일하므로 1번만 평가해 같은 값을 공유한다(표시 일관성 + 계산 절약).
  // 값은 Promise로 캐시 — 병렬 평가에서도 중복 계산이 생기지 않는다.
  const canonCache = new Map();
  const dedup = (key, compute) => {
    let v = canonCache.get(key);
    if (v === undefined) { v = Promise.resolve().then(compute); canonCache.set(key, v); }
    return v;
  };
  // 옵션 간 비교는 공통 난수 페어링(pairBase)으로: k번째 롤아웃마다 모든 후보가
  // 동일한 주사위 흐름을 겪게 해, 근소차 국면에서 순위가 샘플링 노이즈로
  // 뒤집히는 것을 구조적으로 줄인다(차이의 분산 감소).
  const evalMy = (L) => {
    const alk = wouldTriggerAlkkagi(state, 'me', L, die);
    const key = alk
      ? 'a|' + canonicalKey(resolveAlkkagi(state, 'me', L, die))
      : 'p|' + canonicalKey(endTurn(placeDie(state, 'me', L, { value: die, shield: false })));
    return dedup(key, () =>
      exact
        ? exactMyPlacementValue(state, L, die, budget)
        : ev.my(state, L, die, rollouts, baseSeed + 1_000_000, mcOpts));
  };
  const evalBonus = (t) => {
    const key = 'p|' + canonicalKey(endTurn(placeDie(state, t.side, t.lineIndex, { value: die, shield: true })));
    return dedup(key, () =>
      exact
        ? exactBonusPlacementValue(state, t, die, budget)
        : ev.bonus(state, t, die, rollouts, baseSeed + 2_000_000, mcOpts));
  };

  // 1단계: 모든 옵션을 동시에 평가(워커 풀이면 코어 수만큼 병렬).
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
  for (const o of options) o.winProb = await o.winProb;
  options.sort((a, b) => b.winProb - a.winProb);

  // 2단계 — 근소차 재평가: 1·2위 차이가 REFINE_MARGIN 이내면 그 폭 안의 상위 후보만
  // 고롤아웃 + 공통 난수 페어링으로 다시 계산해 순위·표시값을 확정한다.
  if (!exact && options.length >= 2 && options[0].winProb - options[1].winProb <= REFINE_MARGIN) {
    const top = options[0].winProb;
    const cands = options
      .filter((o) => top - o.winProb <= REFINE_MARGIN)
      .slice(0, REFINE_MAX_CANDIDATES);
    await Promise.all(cands.map(async (o) => {
      o.winProb = isBonus
        ? await ev.bonus(state, o.target, die, refineRollouts, baseSeed + 3_000_000, mcOpts)
        : await ev.my(state, o.target.lineIndex, die, refineRollouts, baseSeed + 3_000_000, mcOpts);
    }));
    options.sort((a, b) => b.winProb - a.winProb);
  }

  // 3단계 — 밑장(리롤) 조언.
  let mitjang = null;
  if (!isBonus && state.me.hasMitjang && options[0]) {
    const baseWinProb = options[0].winProb;
    // 밑장 값은 항상 ≤ 1.0. base가 이미 (1 - margin) 이상이면 리롤이 margin만큼 못 넘김
    // → 권장은 확정적으로 false. 무손실 단축(비싼 밑장 계산 생략).
    if (baseWinProb >= 1 - MITJANG_MARGIN) {
      mitjang = { recommend: false, baseWinProb, mitjangWinProb: baseWinProb };
    } else {
      const mr = exact ? rollouts : mitRollouts; // 완전탐색은 rollouts 무의미. MC만 축소 롤아웃.
      const mitjangWinProb = await mitjangValue(state, die, exact, budget, baseSeed, mr, mcOpts, ev);
      mitjang = { recommend: mitjangWinProb > baseWinProb + MITJANG_MARGIN, baseWinProb, mitjangWinProb };
    }
  }
  return { options, mitjang };
}

async function bestMyValue(state, value, exact, budget, pairBase, rollouts, mcOpts, ev) {
  const lines = legalLines(state, 'me');
  if (lines.length === 0) return 0;
  const vals = await Promise.all(lines.map((L) =>
    exact
      ? Promise.resolve().then(() => exactMyPlacementValue(state, L, value, budget))
      : ev.my(state, L, value, rollouts, pairBase, mcOpts)));
  return Math.max(...vals);
}

async function mitjangValue(state, die, exact, budget, baseSeed, rollouts, mcOpts, ev) {
  const consumed = setMitjang(state, 'me', false);
  // die를 그대로 둘 때의 값 — 밑장을 '소진한' 상태로 재계산해야 한다.
  // (MC 롤아웃도 이제 남은 밑장의 미래 가치를 모델링하므로 base 최고값과 다르다)
  // 주사위 값별로 서로 다른 pairBase를 쓰되(값이 다르면 다른 미래), 같은 값 안의
  // 라인 비교는 공통 난수로 페어링된다.
  const tag = (v) => baseSeed + 4_000_000 + v * 10_000;
  const others = [];
  for (let r2 = 1; r2 <= 6; r2++) if (r2 !== die) others.push(r2);
  const [vDie, ...vR2s] = await Promise.all([
    bestMyValue(consumed, die, exact, budget, tag(die), rollouts, mcOpts, ev),
    ...others.map((r2) => bestMyValue(consumed, r2, exact, budget, tag(r2), rollouts, mcOpts, ev)),
  ]);
  let acc = 0;
  for (const vR2 of vR2s) acc += Math.max(vDie, vR2);
  return acc / others.length;
}

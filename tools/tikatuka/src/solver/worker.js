import { recommend, sequentialEvaluator, plannedRollouts } from './recommend.js';
import { nnRecommend } from './nn-search.js';
import { makeRng } from './evaluate.js';
import { initMcPool } from './mc-pool.js';
import { remainingEmpty } from '../state.js';
import { legalLines, emptyTargets } from '../rules.js';

// 기본은 규칙 기반 솔버(정확·신뢰). 학습 모델(NN)은 out-of-distribution 상황에서
// 가치 오판이 있어 실험 옵션(opts.useNN)으로만 사용한다.
let net = null;
let modelReq = null;
function ensureModel() {
  if (!modelReq) {
    modelReq = fetch(new URL('./model.json', import.meta.url))
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { net = m && m.layers ? m : null; })
      .catch(() => { net = null; });
  }
  return modelReq;
}

// ── 멀티코어 워커 풀(지연 초기화) ──
// 지원 환경이면 롤아웃을 코어 수만큼 병렬 계산(결과는 순차와 완전히 동일 — CRN 범위합).
// 미지원/실패 환경은 null → 순차 평가기 폴백.
let poolReq = null;
function ensurePool() {
  if (!poolReq) poolReq = initMcPool().catch(() => null);
  return poolReq;
}

// ── 기기 속도 자동 보정 ──
// 계산 직전에 이 국면으로 처리량을 짧게 실측해, 목표 시간에 맞게 롤아웃 예산을
// 축소(scale ≤ 1)한다. 빠른 기기는 scale=1(무손실), 느린 기기만 축소되며
// recommend 쪽 품질 하한(FLOOR_*)이 "빠르지만 엉터리"를 방지한다.
const TARGET_MS = 2800;
const TARGET_MS_PRECISE = 9000;
const CAL_N_PER_CORE = 150;
async function computeScale(evaluator, state, die, o) {
  try {
    const calN = CAL_N_PER_CORE * (evaluator.concurrency ?? 1);
    const mcOpts = { realAI: !!o.realAI };
    const t0 = Date.now();
    if (o.isBonus) {
      const t = emptyTargets(state)[0];
      if (!t) return 1;
      await evaluator.bonus(state, t, die, calN, 9_999_000, mcOpts);
    } else {
      const L = legalLines(state, 'me')[0];
      if (L === undefined) return 1;
      await evaluator.my(state, L, die, calN, 9_999_000, mcOpts);
    }
    const ms = Math.max(1, Date.now() - t0);
    const throughput = calN / ms; // 롤아웃/ms (풀 전체 기준)
    const target = o.precise ? TARGET_MS_PRECISE : TARGET_MS;
    return Math.min(1, (target * throughput) / plannedRollouts(state, die, o));
  } catch {
    return 1;
  }
}

self.onmessage = async (e) => {
  const { id, state, die, opts } = e.data;
  try {
    const o = opts || {};
    let result;
    if (o.useNN) {
      await ensureModel();
      if (net) {
        result = nnRecommend(net, state, die, {
          isBonus: o.isBonus,
          depth: o.depth ?? 1,
          samples: o.samples ?? 6,
          rng: makeRng(o.seed ?? 1234567),
        });
        result.engine = 'nn';
      }
    }
    if (!result) {
      const pool = await ensurePool();
      const evaluator = pool ?? sequentialEvaluator();
      // 종반(빈칸 적음)은 MC 자체가 저렴 + 완전탐색 우선이라 보정 생략(scale=1).
      const wantScale = remainingEmpty(state) > 6;
      try {
        const scale = wantScale ? await computeScale(evaluator, state, die, o) : 1;
        result = await recommend(state, die, { ...o, evaluator, scale });
      } catch (err) {
        if (!pool) throw err;
        // 풀 경로 이상(서브워커 통신 실패 등) → 순차 평가기로 1회 재시도
        result = await recommend(state, die, { ...o, evaluator: sequentialEvaluator() });
      }
      result.engine = 'classic';
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};

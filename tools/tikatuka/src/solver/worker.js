import { recommend } from './recommend.js';
import { nnRecommend } from './nn-search.js';
import { makeRng } from './evaluate.js';

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
      result = recommend(state, die, o);
      result.engine = 'classic';
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};

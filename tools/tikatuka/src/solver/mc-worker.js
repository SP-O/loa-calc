// 멀티코어 병렬화의 말단 실행기: 롤아웃 범위 [k0, k1)의 '합'만 계산해 돌려준다.
// pairBase 범위합(CRN)이라 어떤 분할 경계로 나눠 계산해도 순차 계산과 결과가 동일하다.
import { mcMyPlacementSum, mcBonusPlacementSum } from './montecarlo.js';

self.onmessage = (e) => {
  const { id, kind, state, lineIndex, target, die, k0, k1, pairBase, mcOpts } = e.data;
  try {
    if (kind === 'ping') { self.postMessage({ id, sum: 0 }); return; }
    const sum = kind === 'bonus'
      ? mcBonusPlacementSum(state, target, die, k0, k1, pairBase, mcOpts || {})
      : mcMyPlacementSum(state, lineIndex, die, k0, k1, pairBase, mcOpts || {});
    self.postMessage({ id, sum });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};

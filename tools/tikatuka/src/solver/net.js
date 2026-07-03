// 작은 MLP(다층 퍼셉트론). forward는 학습(Node)과 추론(브라우저) 공용.
// 은닉층 ReLU, 출력층 sigmoid(가치 = me 관점 승률 0~1).
// 외부 ML 라이브러리 없이 순수 JS로 구현 → 가중치는 그대로 JSON 직렬화 가능.

import { makeRng } from './evaluate.js';

function gauss(rng) {
  // Box-Muller: 표준정규 난수
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function applyAct(z, act) {
  if (act === 'relu') return z.map((v) => (v > 0 ? v : 0));
  if (act === 'sigmoid') return z.map((v) => 1 / (1 + Math.exp(-v)));
  return z.slice(); // linear
}

export function actDeriv(z, act) {
  if (act === 'relu') return z.map((v) => (v > 0 ? 1 : 0));
  if (act === 'sigmoid') return z.map((v) => { const s = 1 / (1 + Math.exp(-v)); return s * (1 - s); });
  return z.map(() => 1);
}

// sizes 예: [75, 128, 128, 1] → 은닉 ReLU, 마지막 sigmoid
export function createNet(sizes, rng = makeRng(12345)) {
  const layers = [];
  for (let l = 1; l < sizes.length; l++) {
    const inN = sizes[l - 1];
    const outN = sizes[l];
    const act = l === sizes.length - 1 ? 'sigmoid' : 'relu';
    const scale = Math.sqrt(2 / inN); // He 초기화
    const W = [];
    for (let j = 0; j < outN; j++) {
      const row = [];
      for (let i = 0; i < inN; i++) row.push(gauss(rng) * scale);
      W.push(row);
    }
    const b = new Array(outN).fill(0);
    layers.push({ W, b, act });
  }
  return { sizes, layers };
}

// forward: 가치 + 역전파용 캐시(층별 pre-activation z, post-activation a) 반환
export function forward(net, x) {
  let a = x;
  const acts = [x];
  const zs = [];
  for (const layer of net.layers) {
    const out = layer.b.length;
    const z = new Array(out);
    for (let j = 0; j < out; j++) {
      let s = layer.b[j];
      const Wj = layer.W[j];
      for (let i = 0; i < a.length; i++) s += Wj[i] * a[i];
      z[j] = s;
    }
    const aOut = applyAct(z, layer.act);
    zs.push(z);
    acts.push(aOut);
    a = aOut;
  }
  return { value: a[0], acts, zs };
}

export function predict(net, x) {
  return forward(net, x).value;
}

export function serialize(net) {
  return JSON.stringify(net);
}

export function deserialize(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}

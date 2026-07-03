// AlphaZero 신경망: 공유 몸통(ReLU) → 가치 head(sigmoid, me 관점 승률) + 정책 head(softmax).
// 손실 = 가치 MSE + 정책 교차엔트로피. 학습/추론 공용, 외부 라이브러리 없음.

import { makeRng } from './evaluate.js';
import { applyAct, actDeriv } from './net.js';

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function denseLayer(inN, outN, act, rng) {
  const scale = Math.sqrt(2 / inN);
  const W = [];
  for (let j = 0; j < outN; j++) {
    const row = [];
    for (let i = 0; i < inN; i++) row.push(gauss(rng) * scale);
    W.push(row);
  }
  return { W, b: new Array(outN).fill(0), act };
}

function denseForward(layer, x) {
  const out = layer.b.length;
  const z = new Array(out);
  for (let j = 0; j < out; j++) {
    let s = layer.b[j];
    const Wj = layer.W[j];
    for (let i = 0; i < x.length; i++) s += Wj[i] * x[i];
    z[j] = s;
  }
  return { z, a: applyAct(z, layer.act) };
}

// sizes = 몸통 [input, h1, h2, ...]; 마지막 차원에서 두 head로 분기
export function createAzNet(sizes, numActions = 6, rng = makeRng(123)) {
  const body = [];
  for (let l = 1; l < sizes.length; l++) body.push(denseLayer(sizes[l - 1], sizes[l], 'relu', rng));
  const h = sizes[sizes.length - 1];
  const valueHead = denseLayer(h, 1, 'sigmoid', rng);
  const policyHead = denseLayer(h, numActions, 'linear', rng);
  return { sizes, numActions, body, valueHead, policyHead };
}

export function azForward(net, x) {
  const bodyCache = [{ a: x, z: null }];
  let a = x;
  for (const layer of net.body) {
    const o = denseForward(layer, a);
    bodyCache.push({ a: o.a, z: o.z });
    a = o.a;
  }
  const h = a;
  const vo = denseForward(net.valueHead, h);
  const po = denseForward(net.policyHead, h);
  return { value: vo.a[0], policyLogits: po.a, h, bodyCache };
}

export function softmaxMasked(logits, mask) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i] && logits[i] > max) max = logits[i];
  if (max === -Infinity) max = 0;
  const ex = logits.map((l, i) => (mask[i] ? Math.exp(l - max) : 0));
  const sum = ex.reduce((s, x) => s + x, 0) || 1;
  return ex.map((x) => x / sum);
}

export function azLoss(fwd, vTarget, piTarget, mask) {
  const vL = 0.5 * (fwd.value - vTarget) ** 2;
  const p = softmaxMasked(fwd.policyLogits, mask);
  let cL = 0;
  for (let a = 0; a < p.length; a++) if (mask[a] && piTarget[a] > 0) cL -= piTarget[a] * Math.log(p[a] + 1e-12);
  return vL + cL;
}

function headGrad(layer, h, dz) {
  const dW = layer.W.map(() => new Array(h.length).fill(0));
  const db = new Array(layer.b.length).fill(0);
  for (let j = 0; j < layer.b.length; j++) {
    db[j] = dz[j];
    for (let i = 0; i < h.length; i++) dW[j][i] = dz[j] * h[i];
  }
  return { dW, db };
}

// 가치 MSE + 정책 CE의 결합 그래디언트
export function azBackward(net, fwd, vTarget, piTarget, mask) {
  const { value, policyLogits, h, bodyCache } = fwd;
  const p = softmaxMasked(policyLogits, mask);

  const dzV = [(value - vTarget) * value * (1 - value)]; // sigmoid + MSE
  const dzP = policyLogits.map((_, a) => (mask[a] ? p[a] - (piTarget[a] || 0) : 0)); // softmax CE

  const gValueHead = headGrad(net.valueHead, h, dzV);
  const gPolicyHead = headGrad(net.policyHead, h, dzP);

  // dL/dh = valueHead^T dzV + policyHead^T dzP
  const dh = new Array(h.length).fill(0);
  for (let i = 0; i < h.length; i++) {
    let s = 0;
    for (let j = 0; j < net.valueHead.b.length; j++) s += net.valueHead.W[j][i] * dzV[j];
    for (let j = 0; j < net.policyHead.b.length; j++) s += net.policyHead.W[j][i] * dzP[j];
    dh[i] = s;
  }

  const L = net.body.length;
  const gBody = net.body.map((layer) => ({ dW: layer.W.map((r) => r.map(() => 0)), db: layer.b.map(() => 0) }));
  // 마지막 몸통 층 delta = dh * act'(z_last)
  let delta = dh.map((d, i) => d * actDeriv(bodyCache[L].z, net.body[L - 1].act)[i]);
  for (let l = L - 1; l >= 0; l--) {
    const aPrev = bodyCache[l].a;
    const layer = net.body[l];
    for (let j = 0; j < layer.b.length; j++) {
      gBody[l].db[j] += delta[j];
      const dWj = gBody[l].dW[j];
      const dj = delta[j];
      for (let i = 0; i < aPrev.length; i++) dWj[i] += dj * aPrev[i];
    }
    if (l > 0) {
      const der = actDeriv(bodyCache[l].z, net.body[l - 1].act);
      const dPrev = new Array(aPrev.length).fill(0);
      for (let i = 0; i < aPrev.length; i++) {
        let s = 0;
        for (let j = 0; j < layer.b.length; j++) s += layer.W[j][i] * delta[j];
        dPrev[i] = s * der[i];
      }
      delta = dPrev;
    }
  }
  return { body: gBody, valueHead: gValueHead, policyHead: gPolicyHead };
}

function applyLayer(layer, g, lr) {
  for (let j = 0; j < layer.b.length; j++) {
    layer.b[j] -= lr * g.db[j];
    for (let i = 0; i < layer.W[j].length; i++) layer.W[j][i] -= lr * g.dW[j][i];
  }
}

// 단순 SGD 갱신(검증/소규모용). 본 학습은 az-train.js의 Adam 사용.
export function azApplyGrads(net, grads, lr) {
  applyLayer(net.valueHead, grads.valueHead, lr);
  applyLayer(net.policyHead, grads.policyHead, lr);
  net.body.forEach((layer, l) => applyLayer(layer, grads.body[l], lr));
}

// ---- Adam 옵티마이저(본 학습용) ----
function zeroGrad(layer) {
  return { dW: layer.W.map((r) => r.map(() => 0)), db: layer.b.map(() => 0) };
}
function addGradLayer(acc, g) {
  for (let j = 0; j < acc.db.length; j++) {
    acc.db[j] += g.db[j];
    for (let i = 0; i < acc.dW[j].length; i++) acc.dW[j][i] += g.dW[j][i];
  }
}
function layerAdamState(layer) {
  return {
    mW: layer.W.map((r) => r.map(() => 0)), vW: layer.W.map((r) => r.map(() => 0)),
    mb: layer.b.map(() => 0), vb: layer.b.map(() => 0),
  };
}
function adamLayer(layer, grad, st, n, lr, t, b1, b2, eps) {
  for (let j = 0; j < layer.b.length; j++) {
    const gb = grad.db[j] / n;
    st.mb[j] = b1 * st.mb[j] + (1 - b1) * gb;
    st.vb[j] = b2 * st.vb[j] + (1 - b2) * gb * gb;
    layer.b[j] -= (lr * (st.mb[j] / (1 - b1 ** t))) / (Math.sqrt(st.vb[j] / (1 - b2 ** t)) + eps);
    const Wj = layer.W[j];
    const gWj = grad.dW[j];
    for (let i = 0; i < Wj.length; i++) {
      const gw = gWj[i] / n;
      st.mW[j][i] = b1 * st.mW[j][i] + (1 - b1) * gw;
      st.vW[j][i] = b2 * st.vW[j][i] + (1 - b2) * gw * gw;
      Wj[i] -= (lr * (st.mW[j][i] / (1 - b1 ** t))) / (Math.sqrt(st.vW[j][i] / (1 - b2 ** t)) + eps);
    }
  }
}

export function azAdamInit(net) {
  return {
    t: 0,
    body: net.body.map(layerAdamState),
    valueHead: layerAdamState(net.valueHead),
    policyHead: layerAdamState(net.policyHead),
  };
}

// 배치 학습 1스텝(Adam). samples: [{x, v, pi, mask}]. 평균 손실 반환.
export function azTrainBatch(net, samples, adam, opts = {}) {
  const lr = opts.lr ?? 0.01;
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;
  adam.t += 1;
  const acc = { body: net.body.map(zeroGrad), valueHead: zeroGrad(net.valueHead), policyHead: zeroGrad(net.policyHead) };
  let loss = 0;
  for (const s of samples) {
    const fwd = azForward(net, s.x);
    loss += azLoss(fwd, s.v, s.pi, s.mask);
    const g = azBackward(net, fwd, s.v, s.pi, s.mask);
    addGradLayer(acc.valueHead, g.valueHead);
    addGradLayer(acc.policyHead, g.policyHead);
    for (let l = 0; l < net.body.length; l++) addGradLayer(acc.body[l], g.body[l]);
  }
  const n = samples.length;
  adamLayer(net.valueHead, acc.valueHead, adam.valueHead, n, lr, adam.t, b1, b2, eps);
  adamLayer(net.policyHead, acc.policyHead, adam.policyHead, n, lr, adam.t, b1, b2, eps);
  net.body.forEach((layer, l) => adamLayer(layer, acc.body[l], adam.body[l], n, lr, adam.t, b1, b2, eps));
  return loss / n;
}

export function serializeAz(net) { return JSON.stringify(net); }
export function deserializeAz(json) { return typeof json === 'string' ? JSON.parse(json) : json; }

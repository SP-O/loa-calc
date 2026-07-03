// 학습 전용 모듈(Node에서만 사용): 가치 회귀 역전파 + Adam 옵티마이저.
// 손실 = 0.5 * (value - target)^2  (target = me 관점 승률 0~1)

import { forward, actDeriv } from './net.js';

export function mseLoss(value, target) {
  const d = value - target;
  return 0.5 * d * d;
}

// 한 샘플에 대한 그래디언트(dW, db) 계산
export function backwardValue(net, fwd, target) {
  const { acts, zs } = fwd;
  const L = net.layers.length;
  const grads = net.layers.map((layer) => ({
    dW: layer.W.map((row) => row.map(() => 0)),
    db: layer.b.map(() => 0),
  }));

  // 출력층 delta = dLoss/dz
  const outVal = acts[L][0];
  const dLoss_dout = outVal - target; // d(0.5(out-target)^2)/dout
  let delta = actDeriv(zs[L - 1], net.layers[L - 1].act).map((d, j) => (j === 0 ? dLoss_dout * d : 0));

  for (let l = L - 1; l >= 0; l--) {
    const layer = net.layers[l];
    const aPrev = acts[l];
    for (let j = 0; j < layer.b.length; j++) {
      grads[l].db[j] += delta[j];
      const dWj = grads[l].dW[j];
      const dj = delta[j];
      for (let i = 0; i < aPrev.length; i++) dWj[i] += dj * aPrev[i];
    }
    if (l > 0) {
      const zPrev = zs[l - 1];
      const derPrev = actDeriv(zPrev, net.layers[l - 1].act);
      const dPrev = new Array(aPrev.length).fill(0);
      for (let i = 0; i < aPrev.length; i++) {
        let s = 0;
        for (let j = 0; j < layer.b.length; j++) s += layer.W[j][i] * delta[j];
        dPrev[i] = s * derPrev[i];
      }
      delta = dPrev;
    }
  }
  return grads;
}

export function adamInit(net) {
  return {
    t: 0,
    state: net.layers.map((layer) => ({
      mW: layer.W.map((row) => row.map(() => 0)),
      vW: layer.W.map((row) => row.map(() => 0)),
      mb: layer.b.map(() => 0),
      vb: layer.b.map(() => 0),
    })),
  };
}

// 배치 학습 1스텝: 평균 그래디언트로 Adam 갱신, 평균 손실 반환
export function trainBatch(net, samples, adam, opts = {}) {
  const lr = opts.lr ?? 0.01;
  const beta1 = opts.beta1 ?? 0.9;
  const beta2 = opts.beta2 ?? 0.999;
  const eps = opts.eps ?? 1e-8;
  adam.t = (adam.t || 0) + 1;
  const t = adam.t;

  // 누적 그래디언트
  const acc = net.layers.map((layer) => ({
    dW: layer.W.map((row) => row.map(() => 0)),
    db: layer.b.map(() => 0),
  }));
  let lossSum = 0;
  for (const { x, y } of samples) {
    const fwd = forward(net, x);
    lossSum += mseLoss(fwd.value, y);
    const g = backwardValue(net, fwd, y);
    for (let l = 0; l < net.layers.length; l++) {
      for (let j = 0; j < acc[l].db.length; j++) {
        acc[l].db[j] += g[l].db[j];
        const accW = acc[l].dW[j];
        const gW = g[l].dW[j];
        for (let i = 0; i < accW.length; i++) accW[i] += gW[i];
      }
    }
  }
  const n = samples.length;

  for (let l = 0; l < net.layers.length; l++) {
    const layer = net.layers[l];
    const st = adam.state[l];
    for (let j = 0; j < layer.b.length; j++) {
      // bias
      const gb = acc[l].db[j] / n;
      st.mb[j] = beta1 * st.mb[j] + (1 - beta1) * gb;
      st.vb[j] = beta2 * st.vb[j] + (1 - beta2) * gb * gb;
      const mbHat = st.mb[j] / (1 - Math.pow(beta1, t));
      const vbHat = st.vb[j] / (1 - Math.pow(beta2, t));
      layer.b[j] -= (lr * mbHat) / (Math.sqrt(vbHat) + eps);
      // weights
      const Wj = layer.W[j];
      const mWj = st.mW[j];
      const vWj = st.vW[j];
      const gWj = acc[l].dW[j];
      for (let i = 0; i < Wj.length; i++) {
        const gw = gWj[i] / n;
        mWj[i] = beta1 * mWj[i] + (1 - beta1) * gw;
        vWj[i] = beta2 * vWj[i] + (1 - beta2) * gw * gw;
        const mHat = mWj[i] / (1 - Math.pow(beta1, t));
        const vHat = vWj[i] / (1 - Math.pow(beta2, t));
        Wj[i] -= (lr * mHat) / (Math.sqrt(vHat) + eps);
      }
    }
  }
  return lossSum / n;
}

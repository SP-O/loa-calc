// src/vision/vision-worker.js — Web Worker(type:module). 프레임 인식 → 보드 상태. 솔버 worker.js와 별개.
import { recognizeFrame } from './recognize.js';
import { toBoardState } from './adapter.js';

self.onmessage = (e) => {
  const { buffer, width, height, boardRect } = e.data;
  const frame = { data: new Uint8ClampedArray(buffer), width, height };
  const now = () => (self.performance && self.performance.now ? self.performance.now() : Date.now());
  const t0 = now();
  const board = toBoardState(recognizeFrame(frame, boardRect || null));
  self.postMessage({ board, ms: now() - t0 });
};

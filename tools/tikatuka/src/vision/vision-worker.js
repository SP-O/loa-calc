// src/vision/vision-worker.js — Web Worker(type:module). 프레임 인식 → 보드 상태. 솔버 worker.js와 별개.
import { recognizeFrame } from './recognize.js';
import { toBoardState } from './adapter.js';
import { detectReroll } from './reroll.js';
import { detectRerollChoice } from './recognize.js';

self.onmessage = (e) => {
  const { buffer, width, height, boardRect } = e.data;
  const frame = { data: new Uint8ClampedArray(buffer), width, height };
  const now = () => (self.performance && self.performance.now ? self.performance.now() : Date.now());
  const t0 = now();
  const board = toBoardState(recognizeFrame(frame, boardRect || null));
  // 밑장빼기 버튼 상태(내/상대 리롤 남음 여부) — null이면 판단 불가(옵션 미갱신)
  board.reroll = detectReroll(frame, boardRect || null);
  // 리롤 직후 두 주사위 선택 상태(내 턴 아님으로 인식되는 순간) — 내 턴이면 불필요
  board.rerollChoice = board.isMyTurn ? null : detectRerollChoice(frame, boardRect || null);
  self.postMessage({ board, ms: now() - t0 });
};

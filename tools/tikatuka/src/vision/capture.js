// src/vision/capture.js — 브라우저 결합부(getDisplayMedia/canvas). isBlackFrame만 순수.
// 모듈 평가 시 브라우저 전역에 접근하지 않음(함수 본문에서만 navigator/document 사용) → Node import 안전.

export function isBlackFrame(frame, threshold = 8) {
  const d = frame.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  const n = frame.width * frame.height;
  return n === 0 ? true : sum / (n * 3) < threshold;
}

export async function connect() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  return { stream, video, _canvas: null };
}

export function grabFrame(handle) {
  const { video } = handle;
  const w = video.videoWidth, h = video.videoHeight;
  if (!handle._canvas) handle._canvas = document.createElement('canvas');
  const canvas = handle._canvas;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

export function disconnect(handle) {
  if (handle && handle.stream) handle.stream.getTracks().forEach((t) => t.stop());
}

// build-templates.mjs — 실캡처 5장 + 정답 라벨로 주사위 면(1~6) 템플릿 재제작. Node 전용.
// 실행: node src/vision/build-templates.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { loadPng } from '../../tests/vision/png.mjs';
import { toGray, normPatch } from './image.js';
import { computeLayout } from './layout.js';
import { findDieBlob } from './blob.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '../../vision-fixtures');
const TPL = 70;
const rect = (mlx, r1y) => ({ x: mlx - 96, y: r1y - 72, w: 979, h: 434 });

// 라이브 5장: 격자기준 + 정답(공간 좌→우, 0=빈칸) + 굴린주사위
const DATA = [
  { n: '10-live-capture.png', r: rect(888, 654), roll: 6, me: [[0,0,4],[0,0,0],[0,0,0]], opp: [[0,0,0],[4,0,0],[0,0,0]] },
  { n: '11-live.png', r: rect(885, 653), roll: 2, me: [[2,4,4],[1,2,2],[0,5,4]], opp: [[6,1,1],[3,1,5],[3,6,1]] },
  { n: '12-live.png', r: rect(892, 626), roll: 3, me: [[3,6,2],[2,5,6],[0,6,6]], opp: [[5,5,0],[3,0,0],[2,2,2]] },
  { n: '13-live.png', r: rect(890, 616), roll: 1, me: [[0,1,2],[5,5,6],[5,2,4]], opp: [[2,5,5],[3,0,0],[3,1,0]] },
  { n: '14-live.png', r: rect(894, 616), roll: 2, me: [[3,2,2],[0,4,2],[6,5,5]], opp: [[1,1,4],[4,6,3],[4,4,3]] },
];

const sums = {}; // value -> {acc:Float64Array, n}
function add(v, patch) {
  if (!sums[v]) sums[v] = { acc: new Float64Array(TPL * TPL), n: 0 };
  const s = sums[v]; for (let i = 0; i < patch.length; i++) s.acc[i] += patch[i]; s.n++;
}
for (const d of DATA) {
  const gray = toGray(loadPng(join(FIX, d.n)));
  const L = computeLayout(d.r);
  for (const side of ['me', 'opp']) for (let li = 0; li < 3; li++) for (let ci = 0; ci < 3; ci++) {
    const v = d[side][li][ci]; if (!v) continue;
    const c = L.cells[side][li][ci]; const b = findDieBlob(gray, c.cx, c.cy, 48);
    if (b) add(v, normPatch(gray, b.cx, b.cy, TPL));
  }
  const hb = findDieBlob(gray, L.holdMine.cx, L.holdMine.cy, 70);
  if (hb) add(d.roll, normPatch(gray, hb.cx, hb.cy, TPL));
}

let out = '// 실캡처 5장(10~14-live) + 정답으로 재제작한 주사위 면 템플릿(회색조 정규화 70x70).\n';
out += '// build-templates.mjs 산출물. LOO 교차검증 ~95.7%.\n';
out += `export const TPL_SIZE = ${TPL};\nexport const TEMPLATES = {\n`;
for (let v = 1; v <= 6; v++) {
  const s = sums[v]; if (!s) throw new Error(`값 ${v} 샘플 없음`);
  const avg = Array.from(s.acc, (x) => +(x / s.n).toFixed(3));
  out += `  ${v}: Float32Array.from([${avg.join(',')}]),\n`;
}
out += '};\n';
writeFileSync(join(HERE, 'templates-data.js'), out);
console.log('templates-data.js 재생성. 샘플수:', Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.n])));

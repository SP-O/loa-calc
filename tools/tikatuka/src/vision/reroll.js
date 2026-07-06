// src/vision/reroll.js — 밑장빼기(리롤) 버튼 상태 인식.
// 버튼("타짜의 손놀림")은 보드 사각형 바로 아래, 홀딩박스와 같은 쪽에 있다.
//   사용 가능: 초록 몸체(내 턴일 때). 사용됨: 회색 몸체 + 크림색 체크 글리프.
//   미사용+비활성(상대 턴 등): 회색 몸체, 체크 없음(텍스트는 어두워 흰색 아님).
// → hasReroll = 체크가 없으면 true. (초록이면 당연히 체크 없음)
// 모든 좌표는 cellSize 비례(해상도 무관) — 픽스처 실측: 2560(cs=80)·1920창모드(cs=56) 검증.
import { computeLayout } from './layout.js';

// 버튼 몸체(초록 판정) 상자: 홀딩 cx 기준 ±1.1cs, 보드 하단 +0.10~+0.70cs
const BTN_HALF_W = 1.1;
const BTN_Y0 = 0.10;
const BTN_Y1 = 0.70;
// 체크 글리프는 버튼 안 좌우 비대칭 위치(내 −0.4cs / 상대 +0.2cs 부근)라 고정 존 대신
// 버튼 영역 전체에서 작은 창을 슬라이드하며 흰픽셀 비율의 최대값을 본다(위치 오차에 강인).
const CHECK_WIN = 0.3;    // 슬라이딩 창 크기(cs) ≈ 글리프(0.36x0.26cs)에 맞춤
const CHECK_STEP = 0.075;

const GREEN_MIN_FRAC = 0.15;
// 픽스처 실측: 사용됨(체크) 7~24%, 비활성 텍스트 ~0%(어두워서 엄격 흰색을 못 넘음)
const CHECK_MIN_FRAC = 0.05;

function isGreen(r, g, b) { return g > 70 && g - r > 12 && g - b > 25; }
// 체크는 크림색(흰 강조) — 문턱을 엄격하게 둬야 버튼 텍스트와 분리된다
function isCheckWhite(r, g, b) { return r > 200 && g > 200 && b > 190; }

function frac(frame, x0, x1, y0, y1, pred) {
  const X0 = Math.round(x0), X1 = Math.round(x1);
  const Y0 = Math.round(y0), Y1 = Math.round(y1);
  if (X0 < 0 || Y0 < 0 || X1 >= frame.width || Y1 >= frame.height || X1 <= X0 || Y1 <= Y0) return null;
  let hit = 0, n = 0;
  const d = frame.data, W = frame.width;
  for (let y = Y0; y <= Y1; y += 2) {
    for (let x = X0; x <= X1; x += 2) {
      const i = (y * W + x) * 4;
      n++;
      if (pred(d[i], d[i + 1], d[i + 2])) hit++;
    }
  }
  return n ? hit / n : null;
}

function detectSide(frame, boardRect, hold, cs) {
  const bottom = boardRect.y + boardRect.h;
  const g = frac(frame,
    hold.cx - BTN_HALF_W * cs, hold.cx + BTN_HALF_W * cs,
    bottom + BTN_Y0 * cs, bottom + BTN_Y1 * cs, isGreen);
  if (g === null) return null; // 버튼 영역이 프레임 밖 → 판단 불가
  if (g > GREEN_MIN_FRAC) return true; // 초록 = 지금 누를 수 있음 = 남아 있음
  let maxWhite = 0;
  for (let fy = BTN_Y0; fy + CHECK_WIN <= 0.95; fy += CHECK_STEP) {
    for (let fx = -BTN_HALF_W; fx + CHECK_WIN <= BTN_HALF_W; fx += CHECK_STEP) {
      const c = frac(frame,
        hold.cx + fx * cs, hold.cx + (fx + CHECK_WIN) * cs,
        bottom + fy * cs, bottom + (fy + CHECK_WIN) * cs, isCheckWhite);
      if (c !== null && c > maxWhite) maxWhite = c;
    }
  }
  return maxWhite > CHECK_MIN_FRAC ? false : true; // 체크 = 사용됨, 회색+체크없음 = 남아 있음
}

/**
 * 리롤 보유 여부 감지.
 * @returns {{ me: boolean|null, opp: boolean|null }} true=남음, false=사용됨, null=판단 불가(영역 밖)
 */
export function detectReroll(frame, boardRect) {
  if (!boardRect) return { me: null, opp: null };
  const L = computeLayout(boardRect);
  const cs = L.cellSize;
  return {
    me: detectSide(frame, boardRect, L.holdMine, cs),
    opp: detectSide(frame, boardRect, L.holdOpp, cs),
  };
}

// src/vision/layout.js
// board rect 기반 비율 격자 레이아웃.
// 모든 칸·홀딩박스·셀크기는 boardRect 내부 비율(fraction)로 저장.
// Tier 1 (앵커→rect) · Tier 2 (box-drag rect) 공용.

// 기준(배율1) 측정값 (스파이크, 02-midgame-shields.png, 앵커 1150,90)
// 내 칸 x: [920, 1049, 1179]  상대 칸 x: [1448, 1577, 1707]
// 행 y: [603, 748, 893]  셀크기: 80(실측)
// 홀딩박스: 내(좌측 녹색), 상대(우측 적색)
//   내 홀딩 대략 x≈764, y≈748 (칸 좌측 약 156px 떨어진 곳)
//   상대 홀딩 대략 x≈1863, y≈748 (칸 우측 약 156px)

// boardRect_ref: 모든 칸을 감싸는 기준 사각형 (여유 포함)
// x = 920 - 96 = 824,  y = 603 - 72 = 531
// w = (1707 + 96) - 824 = 979,  h = (893 + 72) - 531 = 434
const boardRect_ref = { x: 824, y: 531, w: 979, h: 434 };

// 앵커→boardRect 오프셋 (배율1 기준)
const _offX = boardRect_ref.x - 1150; // -326
const _offY = boardRect_ref.y - 90;   //  441

// 내 칸 x 비율
const ME_XS = [920, 1049, 1179].map(x => (x - boardRect_ref.x) / boardRect_ref.w);
// 상대 칸 x 비율
const OPP_XS = [1448, 1577, 1707].map(x => (x - boardRect_ref.x) / boardRect_ref.w);
// 행 y 비율 (3행 공통)
const ROW_YS = [603, 748, 893].map(y => (y - boardRect_ref.y) / boardRect_ref.h);
// 셀크기 비율 (w 기준)
const CELL_FRAC = 80 / boardRect_ref.w;

// 홀딩박스 비율
// 내 홀딩 중심 ≈ (764, 748) — 내 칸 좌측 외부
const _holdMine_cx = 764, _holdMine_cy = 748;
// 상대 홀딩 중심 ≈ (1863, 748) — 상대 칸 우측 외부
const _holdOpp_cx = 1863, _holdOpp_cy = 748;
// 홀딩박스 크기 ≈ 셀크기
const _holdW = 96, _holdH = 96;

const HOLD_MINE_FX = (_holdMine_cx - boardRect_ref.x) / boardRect_ref.w;
const HOLD_MINE_FY = (_holdMine_cy - boardRect_ref.y) / boardRect_ref.h;
const HOLD_OPP_FX = (_holdOpp_cx - boardRect_ref.x) / boardRect_ref.w;
const HOLD_OPP_FY = (_holdOpp_cy - boardRect_ref.y) / boardRect_ref.h;
const HOLD_W_FRAC = _holdW / boardRect_ref.w;
const HOLD_H_FRAC = _holdH / boardRect_ref.h;

// 공개 상수 (외부 참조용)
export const BOARD_REF = Object.freeze({
  ref: boardRect_ref,
  offX: _offX,
  offY: _offY,
  meXs: ME_XS,
  oppXs: OPP_XS,
  rowYs: ROW_YS,
  cellFrac: CELL_FRAC,
});

/**
 * Tier 1: 앵커 좌표+배율 → boardRect {x,y,w,h}
 * @param {{x:number, y:number, scale:number}} anchor
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function anchorToBoardRect({ x, y, scale }) {
  return {
    x: x + _offX * scale,
    y: y + _offY * scale,
    w: boardRect_ref.w * scale,
    h: boardRect_ref.h * scale,
  };
}

/**
 * boardRect → 레이아웃 (18칸 + 홀딩박스 + 셀크기)
 * cells.me / cells.opp: 각 3행×3열, c = {cx, cy}
 * holdMine / holdOpp: {cx, cy, w, h}
 * @param {{x:number, y:number, w:number, h:number}} boardRect
 */
export function computeLayout(boardRect) {
  const { x: bx, y: by, w: bw, h: bh } = boardRect;

  function cell(fx, fy) {
    return { cx: Math.round(bx + fx * bw), cy: Math.round(by + fy * bh) };
  }

  const me = ROW_YS.map(fy => ME_XS.map(fx => cell(fx, fy)));
  const opp = ROW_YS.map(fy => OPP_XS.map(fx => cell(fx, fy)));

  const cellSize = Math.round(CELL_FRAC * bw);
  const hw = Math.round(HOLD_W_FRAC * bw);
  const hh = Math.round(HOLD_H_FRAC * bh);

  const holdMine = {
    cx: Math.round(bx + HOLD_MINE_FX * bw),
    cy: Math.round(by + HOLD_MINE_FY * bh),
    w: hw,
    h: hh,
  };
  const holdOpp = {
    cx: Math.round(bx + HOLD_OPP_FX * bw),
    cy: Math.round(by + HOLD_OPP_FY * bh),
    w: hw,
    h: hh,
  };

  return { cells: { me, opp }, holdMine, holdOpp, cellSize };
}

/**
 * rect {x,y,w,h} 가 [0,width) x [0,height) 내에 완전히 들어오는지
 */
export function inBounds(rect, width, height) {
  return rect.x >= 0 && rect.y >= 0 &&
    rect.x + rect.w <= width &&
    rect.y + rect.h <= height;
}

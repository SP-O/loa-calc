// 오버레이(Document Picture-in-Picture) — 게임 위에 항상 떠 있는 미니 창.
// 필드 현황(인식 확인용)과 계산 결과를 컴팩트하게 보여준다. Chrome/Edge/Whale 116+.
// 내부는 BASE_W(380px) 고정 레이아웃이고, 창 크기에 맞춰 전체를 scale로 확대/축소한다.
import { cellToDieIndex } from './ui-layout.js';

const { watchEffect } = window.Vue;

let pipWin = null;
let stopEffect = null;

const BASE_W = 380;

// Document PiP는 최상위 브라우징 컨텍스트에서만 열 수 있다.
// 로아도쓰 임베드(같은 출처 iframe)에서는 부모 창의 API를 빌려 연다.
function getDpip() {
  try {
    if (window.top !== window && window.top.documentPictureInPicture) {
      return window.top.documentPictureInPicture;
    }
  } catch (_) { /* cross-origin 부모면 접근 불가 → 자체 API로 폴백 */ }
  return window.documentPictureInPicture || null;
}

export function overlaySupported() {
  return !!getDpip();
}

export function isOverlayOpen() {
  return !!pipWin;
}

// 팔레트는 티파고 본가(styles.css)의 다크 토큰을 그대로 사용
const OVERLAY_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: oklch(0.19 0 0); color: oklch(0.9067 0 0);
  font-family: "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif;
  font-size: 15px; line-height: 1.5; user-select: none; overflow-x: hidden;
  font-variant-numeric: tabular-nums;
}
#ov { width: ${BASE_W}px; transform-origin: top left; padding: 10px 12px 12px; }

/* ── 헤더: 자동인식 점 + 굴린 주사위 + 다시 스캔 ── */
.hd { display: flex; align-items: center; gap: 9px; margin-bottom: 2px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: oklch(0.5 0 0); flex: none; }
.dot.on { background: oklch(0.8003 0.1821 151.7035); box-shadow: 0 0 7px oklch(0.8003 0.1821 151.7035); }
.die { font-size: 15px; color: oklch(0.7572 0 0); }
.die b { color: oklch(0.9067 0 0); font-size: 17px; }
.sp { flex: 1; }
button {
  background: oklch(0.28 0 0); color: oklch(0.9067 0 0);
  border: 1px solid oklch(1 0 0 / 0.14); border-radius: 8px;
  padding: 4px 11px; cursor: pointer; font-size: 13.5px; font-family: inherit; font-weight: 500;
}
button:hover { background: oklch(0.33 0 0); }
.status { font-size: 12px; color: oklch(0.66 0 0); min-height: 17px; margin-bottom: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 미니보드: 그리드 정렬(라벨이 주사위 칸 위에 정확히 고정) ── */
.board { width: max-content; margin: 0 auto; display: flex; flex-direction: column; gap: 4px; }
.brow {
  display: grid; grid-template-columns: 13px 104px 32px 10px 32px 104px 13px;
  gap: 5px; align-items: center; padding: 3px 5px;
  border-radius: 9px; border: 1px solid transparent;
}
.brow.bh { padding: 0 5px; }
.bl { font-size: 12px; font-weight: 500; color: oklch(0.7572 0 0); text-align: center; }
.brow.rec { background: oklch(0.8868 0.1822 95.3226 / 0.10); border-color: oklch(0.8868 0.1822 95.3226 / 0.5); }
.brow.warn { background: oklch(0.75 0.15 75 / 0.10); border-color: oklch(0.75 0.15 75 / 0.75); }
.ln { font-size: 11px; color: oklch(0.62 0 0); text-align: center; }
.cells { display: flex; gap: 4px; }
.slot {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  background: oklch(0.245 0 0); border: 1px solid oklch(1 0 0 / 0.10); border-radius: 7px;
  font-size: 16px; color: oklch(0.5 0 0);
}
.slot.filled { color: oklch(0.97 0 0); background: oklch(0.31 0 0); font-weight: 700; }
.slot.shield { border-color: oklch(0.8868 0.1822 95.3226); box-shadow: inset 0 0 0 1px oklch(0.8868 0.1822 95.3226); }
.sum { text-align: center; font-weight: 700; font-size: 17px; }
.sum.win { color: oklch(0.8003 0.1821 151.7035); }
.sum.lose { color: oklch(0.7044 0.1872 23.1825); }
.sum.tie { color: oklch(0.66 0 0); }
.vs { color: oklch(0.5 0 0); font-size: 13px; text-align: center; }

/* ── 계산 결과: 본가처럼 가운데 정렬 ── */
.res { margin-top: 9px; border-top: 1px solid oklch(1 0 0 / 0.08); padding-top: 8px; text-align: center; }
.best-target { font-size: 16px; color: oklch(0.7572 0 0); }
.best-target b { color: oklch(0.9067 0 0); font-weight: 700; }
.tag-alk {
  background: oklch(0.8868 0.1822 95.3226); color: #000; border-radius: 6px;
  padding: 1px 8px; font-size: 12px; font-weight: 700; margin-left: 7px; vertical-align: 2px;
}
.wp { font-size: 27px; font-weight: 800; line-height: 1.25; margin-top: 1px; }
.wp.g { color: oklch(0.8003 0.1821 151.7035); }
.wp.r { color: oklch(0.7044 0.1872 23.1825); }
.close-hint {
  width: max-content; max-width: 100%; margin: 5px auto 0;
  font-size: 12.5px; color: oklch(0.8868 0.1822 95.3226);
  background: oklch(0.8868 0.1822 95.3226 / 0.10); border-radius: 8px; padding: 3px 12px;
}
.mit { font-size: 14px; margin-top: 6px; }
.mit b { font-weight: 700; }
.mit b.yes { color: oklch(0.8003 0.1821 151.7035); }
.mit b.no { color: oklch(0.7572 0 0); }
.mit .mit-d { color: oklch(0.66 0 0); margin-left: 9px; font-size: 13px; }

/* 다른 선택지: 라벨·확률이 고정 열에 정렬(창 폭과 무관) */
.opts { width: max-content; margin: 7px auto 0; }
.opts .o {
  display: grid; grid-template-columns: 150px 52px; gap: 12px;
  padding: 2px 0; font-size: 14px; color: oklch(0.7572 0 0);
  border-bottom: 1px solid oklch(1 0 0 / 0.06);
}
.opts .o:last-child { border-bottom: none; }
.opts .o .t { text-align: left; }
.opts .o .p { text-align: right; color: oklch(0.85 0 0); font-weight: 500; }
.tag-alk-sm { color: oklch(0.8868 0.1822 95.3226); font-size: 12px; margin-left: 5px; }

.idle { color: oklch(0.62 0 0); font-size: 13.5px; padding: 6px 0 2px; }
.abtn {
  margin-top: 8px; width: 100%; padding: 7px 0;
  background: oklch(0.8868 0.1822 95.3226 / 0.14); border-color: oklch(0.8868 0.1822 95.3226 / 0.8);
  color: oklch(0.8868 0.1822 95.3226); font-weight: 700; font-size: 14.5px;
}
.abtn:hover { background: oklch(0.8868 0.1822 95.3226 / 0.22); }
`;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderBoard(ctx) {
  const head = `<div class="brow bh"><span></span><span class="bl">내 필드</span><span></span><span></span><span></span><span class="bl">상대 필드</span><span></span></div>`;
  const rows = [0, 1, 2].map((li) => {
    const cells = (side) => [0, 1, 2].map((c) => {
      const arr = ctx.st[side][li];
      const di = cellToDieIndex(side, arr.length, c);
      const d = di >= 0 ? arr[di] : null;
      return `<span class="slot${d ? ' filled' : ''}${d && d.shield ? ' shield' : ''}">${d ? d.value : '·'}</span>`;
    }).join('');
    const cls = `brow${ctx.rowRec(li) ? ' rec' : ''}${ctx.scanRowWarn(li) ? ' warn' : ''}`;
    return `<div class="${cls}">`
      + `<span class="ln">${li + 1}</span>`
      + `<span class="cells">${cells('me')}</span>`
      + `<span class="sum ${ctx.sumClass('me', li)}">${ctx.sumOf('me', li)}</span>`
      + `<span class="vs">:</span>`
      + `<span class="sum ${ctx.sumClass('opp', li)}">${ctx.sumOf('opp', li)}</span>`
      + `<span class="cells">${cells('opp')}</span>`
      + `<span class="ln">${li + 1}</span>`
      + `</div>`;
  }).join('');
  return `<div class="board">${head}${rows}</div>`;
}

function renderResult(ctx) {
  if (ctx.ui.solving) return `<div class="idle">계산 중…</div>`;
  const r = ctx.ui.result;
  if (r && r._error) return `<div class="idle">계산 오류: ${esc(r._error)}</div>`;
  if (r && r.best) {
    const p = r.best.winProb;
    const wcls = p >= 0.6 ? 'g' : p <= 0.4 ? 'r' : '';
    let html = `<div class="best-target">추천 <b>${ctx.targetLabel(r.best.target)}</b>`
      + `${r.best.alkkagi ? '<span class="tag-alk">알까기!</span>' : ''}</div>`
      + `<div class="wp ${wcls}">${ctx.pct(p)}</div>`;
    if (ctx.isCloseCall(r.options)) {
      html += `<div class="close-hint">선택지 간 차이 ${ctx.closeLeadPct(r.options)}%p — 직감대로 두셔도 좋아요</div>`;
    }
    if (r.mitjang) {
      html += `<div class="mit"><b class="${r.mitjang.recommend ? 'yes' : 'no'}">${r.mitjang.recommend ? '리롤 권장' : '리롤 아껴두기'}</b>`
        + `<span class="mit-d">유지 ${ctx.pct(r.mitjang.baseWinProb)} · 리롤 ${ctx.pct(r.mitjang.mitjangWinProb)}</span></div>`;
    }
    const others = r.options.slice(1, 3);
    if (others.length) {
      html += `<div class="opts">${others.map((o) =>
        `<div class="o"><span class="t">${ctx.targetLabel(o.target)}${o.alkkagi ? '<span class="tag-alk-sm">알까기</span>' : ''}</span><span class="p">${ctx.pct(o.winProb)}</span></div>`
      ).join('')}</div>`;
    }
    if (ctx.canApplyAlkkagi.value) {
      html += `<button class="abtn" data-act="alkkagi">${esc(String(ctx.alkkagiLabel.value).replace('⚡', '').trim())}</button>`;
    }
    return html;
  }
  return `<div class="idle">${ctx.auto.on ? '내 턴에 주사위를 굴리면 자동 계산돼요' : '계산 대기 중'}</div>`;
}

function render(ctx) {
  const dieV = ctx.die.value;
  return `<div class="hd">`
    + `<span class="dot${ctx.auto.on ? ' on' : ''}" title="자동 인식"></span>`
    + `<span class="die">굴린 주사위 : <b>${dieV != null ? dieV : '—'}</b></span>`
    + `<span class="sp"></span>`
    + `${ctx.scan.connected ? '<button data-act="rescan">다시 스캔</button>' : ''}`
    + `</div>`
    + `<div class="status">${esc(ctx.scan.status || '')}</div>`
    + renderBoard(ctx)
    + `<div class="res">${renderResult(ctx)}</div>`;
}

function cleanup() {
  if (stopEffect) { stopEffect(); stopEffect = null; }
  pipWin = null;
}

export async function openOverlay(ctx) {
  if (pipWin) return;
  const win = await getDpip().requestWindow({ width: BASE_W, height: 420 });
  pipWin = win;
  // iframe(임베드)이 내려가면 PiP는 부모 소유라 살아남으므로 직접 닫아준다
  window.addEventListener('pagehide', closeOverlay, { once: true });
  const doc = win.document;
  doc.head.innerHTML = `<meta charset="utf-8">`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">`
    + `<style>${OVERLAY_CSS}</style>`;
  const root = doc.createElement('div');
  root.id = 'ov';
  doc.body.appendChild(root);
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'alkkagi') ctx.applyAlkkagi();
    else if (btn.dataset.act === 'rescan') ctx.scanNow();
  });
  // 창 크기에 맞춰 BASE_W 기준 레이아웃을 통째로 확대/축소 (칸 비율 고정, 우측 퍼짐 방지)
  const applyScale = () => {
    const s = win.innerWidth / BASE_W;
    root.style.transform = `scale(${s})`;
  };
  win.addEventListener('resize', applyScale);
  applyScale();
  stopEffect = watchEffect(() => {
    try { root.innerHTML = render(ctx); }
    catch (err) { root.innerHTML = `<div class="idle">오버레이 렌더 오류</div>`; }
  });
  win.addEventListener('pagehide', () => {
    cleanup();
    if (ctx.onClosed) ctx.onClosed();
  });
}

export function closeOverlay() {
  if (pipWin) pipWin.close(); // pagehide에서 cleanup 수행
}

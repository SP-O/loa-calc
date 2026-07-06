import { lineSum } from './src/scoring.js';
import { cellToDieIndex, nextFillCell } from './src/ui-layout.js';
import { isCloseCall, topLead } from './src/solver/advice.js';
import { connect as captureConnect, grabFrame as captureGrabFrame, disconnect as captureDisconnect, isBlackFrame } from './src/vision/capture.js';
import { boardStateToSt, scanGate } from './src/vision/st-writer.js';
import { createAutoloopState, autoloopStep, boardSignature, createRerollFlow, rerollFlowStep } from './src/vision/autoloop.js';
import { handlesOf, hitTest, applyDrag, toDisplayRect } from './src/vision/calibration.js';
import { computeLayout } from './src/vision/layout.js';
import { openOverlay, closeOverlay, overlaySupported } from './src/overlay.js';

const { createApp, ref, reactive, computed, toRefs, nextTick } = window.Vue;

const worker = new Worker(new URL('./src/solver/worker.js', import.meta.url), { type: 'module' });
let msgId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const cb = pending.get(id);
  if (!cb) return;
  pending.delete(id);
  if (error) cb.reject(new Error(error));
  else cb.resolve(result);
};
function solveAsync(payload) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...payload });
  });
}

createApp({
  setup() {
    // 각 라인은 packed 배열(빈 칸 없음): [{value, shield}, ...] (0 = 먼저 놓인 주사위)
    const emptyBoard = () => [[], [], []];
    const st = reactive({ me: emptyBoard(), opp: emptyBoard() });
    const isBoardEmpty = () => st.me.every((l) => l.length === 0) && st.opp.every((l) => l.length === 0);

    const INPUT_COLLAPSED_KEY = 'tikatuka.inputCollapsed';
    const die = ref(null);
    const ui = reactive({
      selected: null,    // { side, li, dieIndex } 기존 편집 | { side, li, isNew:true } 추가
      bonusMode: false,
      myMitjang: true,
      oppMitjang: false,
      solving: false,
      result: null,
      solvedDie: null,   // 추천 계산 시점의 굴린 주사위(알까기 적용용)
      precise: false,    // 정밀 모드(느림·더 최적)
      realAI: false,     // 실제 AI 상대 모드(실전 AI 성향 반영)
      nextShield: false, // 다음에 놓는 주사위를 실드로(알까기 보너스용, 1회 후 자동 해제)
      rerollChoice: null, // 리롤 직후 두 주사위 선택 추천 { orig, next, origProb, nextProb, pick }
      // 자동 인식 사용 시 수동 입력을 누를 일이 적어 접어 화면공유 시 세로 공간 확보(선택 유지)
      inputCollapsed: localStorage.getItem(INPUT_COLLAPSED_KEY) === '1',
    });
    function toggleInputCollapsed() {
      ui.inputCollapsed = !ui.inputCollapsed;
      localStorage.setItem(INPUT_COLLAPSED_KEY, ui.inputCollapsed ? '1' : '0');
    }

    const history = reactive([]); // 보드 스냅샷 스택(되돌리기)

    // ---- 히스토리 ----
    function snapshot() {
      return {
        me: st.me.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
        opp: st.opp.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      };
    }
    function pushHistory() {
      history.push(snapshot());
      if (history.length > 50) history.shift();
      ui.result = null; // 보드가 바뀌면 이전 추천은 무효
      ui.rerollChoice = null;
    }
    const canUndo = computed(() => history.length > 0);
    function undo() {
      if (history.length === 0) return;
      const snap = history.pop();
      st.me = snap.me;
      st.opp = snap.opp;
      ui.selected = null;
      ui.result = null;
    }

    // ---- 슬롯 조작 ----
    function selectSlot(side, li, cell) {
      const len = st[side][li].length;
      const di = cellToDieIndex(side, len, cell);
      if (di >= 0) {
        ui.selected = { side, li, dieIndex: di };
      } else if (len < 3) {
        ui.selected = { side, li, isNew: true };
      } else {
        ui.selected = null;
      }
    }
    function setSlotValue(n) {
      if (!ui.selected) return;
      const { side, li } = ui.selected;
      pushHistory();
      if (ui.selected.isNew) {
        if (st[side][li].length < 3) {
          // 선공 첫 주사위(빈 보드)·알까기 보너스(nextShield)·보너스 주사위 모드 → 자동 실드
          const shield = isBoardEmpty() || ui.nextShield || ui.bonusMode;
          st[side][li].push({ value: n, shield });
          if (ui.nextShield) ui.nextShield = false; // 한 개 적용 후 자동 해제
          if (ui.bonusMode) ui.bonusMode = false;   // 보너스 주사위 놓은 뒤 일반 모드 복귀
        }
      } else {
        st[side][li][ui.selected.dieIndex].value = n;
      }
      ui.selected = null; // 숫자 입력 후 선택 해제(상호작용 최소화, alt+tab 친화)
    }
    function toggleSlotShield() {
      if (!ui.selected || ui.selected.isNew) return;
      const { side, li, dieIndex } = ui.selected;
      const d = st[side][li][dieIndex];
      if (!d) return;
      pushHistory();
      d.shield = !d.shield;
    }
    function clearSlot() {
      if (!ui.selected) return;
      if (ui.selected.isNew) { ui.selected = null; return; }
      const { side, li, dieIndex } = ui.selected;
      pushHistory();
      st[side][li].splice(dieIndex, 1); // packed → 자동으로 당겨짐
      ui.selected = null;
    }
    function clearSlotAt(side, li, cell) {
      // 우클릭: 해당 칸의 주사위를 바로 제거(빈 칸이면 무시)
      const di = cellToDieIndex(side, st[side][li].length, cell);
      if (di < 0) return;
      pushHistory();
      st[side][li].splice(di, 1);
      ui.selected = null;
    }
    function clearAll() {
      pushHistory();
      st.me = emptyBoard();
      st.opp = emptyBoard();
      ui.selected = null;
    }

    // ---- 표시 헬퍼 ----
    function lineArr(side, li) {
      return st[side][li].map((d) => ({ value: d.value, shield: d.shield }));
    }
    function sumOf(side, li) { return lineSum(st[side][li]); }
    function sumClass(side, li) {
      const a = lineSum(st.me[li]);
      const b = lineSum(st.opp[li]);
      const mine = side === 'me' ? a : b;
      const other = side === 'me' ? b : a;
      return mine > other ? 'win' : mine < other ? 'lose' : 'tie';
    }
    function slotText(side, li, cell) {
      const di = cellToDieIndex(side, st[side][li].length, cell);
      return di >= 0 ? st[side][li][di].value : '·';
    }
    function slotClass(side, li, cell) {
      const len = st[side][li].length;
      const di = cellToDieIndex(side, len, cell);
      const filled = di >= 0;
      let selected = false;
      const sel = ui.selected;
      if (sel && sel.side === side && sel.li === li) {
        if (sel.isNew) selected = cell === nextFillCell(side, len);
        else selected = di === sel.dieIndex;
      }
      return {
        filled,
        shield: filled && st[side][li][di].shield,
        selected,
      };
    }
    function rowRec(li) {
      return !!(ui.result && ui.result.best && ui.result.best.target.lineIndex === li);
    }
    const selectedLabel = computed(() => {
      const sel = ui.selected;
      if (!sel) return '';
      const sideKo = sel.side === 'me' ? '내' : '상대';
      return sel.isNew
        ? `${sideKo} 라인 ${sel.li + 1} (새 주사위)`
        : `${sideKo} 라인 ${sel.li + 1}`;
    });
    const selectedIsNew = computed(() => !!(ui.selected && ui.selected.isNew));

    // ---- 알까기 적용 ----
    const canApplyAlkkagi = computed(() => !!(ui.result && ui.result.best && ui.result.best.alkkagi));
    const alkkagiLabel = computed(() => {
      if (!canApplyAlkkagi.value) return '';
      const L = ui.result.best.target.lineIndex + 1;
      return `⚡ 알까기 적용 (상대 라인 ${L}에서 ${ui.solvedDie} 제거)`;
    });
    function applyAlkkagi() {
      if (!canApplyAlkkagi.value) return;
      const L = ui.result.best.target.lineIndex;
      const v = ui.solvedDie;
      pushHistory(); // ui.result는 여기서 무효화됨
      st.opp[L] = st.opp[L].filter((d) => !(d.value === v && !d.shield));
      ui.selected = null;
      ui.nextShield = true; // 알까기 보너스 주사위는 실드 → 다음에 놓는 주사위 자동 실드
      ui.bonusMode = true;  // 다음 계산은 보너스 주사위 배치(양쪽 후보) 추천
    }

    // ---- 상태 → 엔진 state 변환 ----
    function buildEngineState() {
      const toBoard = (side, hasMitjang) => ({
        lines: [0, 1, 2].map((li) => lineArr(side, li)),
        hasMitjang,
      });
      return {
        me: toBoard('me', ui.myMitjang),
        opp: toBoard('opp', ui.oppMitjang),
        turn: 'me',
      };
    }

    // ---- 솔브 ----
    async function solve() {
      if (!die.value) return;
      ui.solving = true;
      ui.result = null;
      ui.solvedDie = die.value;
      try {
        const state = buildEngineState();
        const result = await solveAsync({ state, die: die.value, opts: { isBonus: ui.bonusMode, seed: 1234567, precise: ui.precise, realAI: ui.realAI } });
        ui.result = result;
      } catch (err) {
        ui.result = { options: [], best: null, mitjang: null, _error: String(err.message) };
      } finally {
        ui.solving = false;
      }
    }

    // ---- 화면 인식(스냅샷 + Tier2) ----
    const visionWorker = new Worker(new URL('./src/vision/vision-worker.js', import.meta.url), { type: 'module' });
    const scan = reactive({ connected: false, busy: false, status: '', lastMs: null, flags: null });
    let captureHandle = null;
    // 연속 자동 루프: 화면을 주기적으로 인식하고, 내 턴에 '새 상태'가 안정적으로 잡히면 자동 적용+계산.
    const auto = reactive({ on: false });
    let loopState = createAutoloopState();
    let rerollFlow = createRerollFlow(); // 리롤 선택→픽 흐름 추적(픽은 강제 재계산)
    let loopTimer = null;
    let inflight = null;      // 진행 중 인식 요청의 출처: 'manual' | 'auto'
    const POLL_MS = 300;

    const REC_KEY = 'tikatuka.boardRect';
    const cal = reactive({ open: false, rect: null, frame: null, scale: 1, dispW: 0, dispH: 0, dragging: null, last: null });
    const guide = reactive({ open: false });
    function openGuide() { guide.open = true; }
    function closeGuide() { guide.open = false; }
    function loadSavedRect() { try { return JSON.parse(localStorage.getItem(REC_KEY)); } catch { return null; } }
    let savedRect = loadSavedRect();

    visionWorker.onmessage = (e) => {
      const { board, ms } = e.data;
      scan.lastMs = Math.round(ms);
      scan.busy = false;
      const mode = inflight; inflight = null;
      // 리롤 선택 흐름 추적: 두주사위 선택 직후 첫 클린 프레임('pick')은 조기 커밋에 관계없이
      // 무조건 재계산해야 한다(오토루프의 committedSig가 flicker로 미리 맞아버리는 버그 방지).
      const flow = rerollFlowStep(rerollFlow, board);
      rerollFlow = flow.state;
      if (mode === 'auto') {
        const gate = scanGate(board);
        // 리롤 직후 두 주사위 선택 대기 상태 → 같은 쌍이 2프레임 연속 확인됐을 때만 계산
        // (도착/픽 애니메이션 중 구르는 면이 유령 쌍으로 오인되는 것 방지)
        if (board.rerollChoice) {
          if (flow.action === 'choice') handleRerollChoice(board);
          else if (!ui.rerollChoice) scan.status = '리롤 주사위 확인 중...';
          return;
        }
        if (flow.action === 'pick') {                        // 픽 확정 → 강제 적용+계산(idle 우회)
          applyScan(board);
          loopState.committedSig = boardSignature(board);
          return;
        }
        const res = autoloopStep(loopState, board, gate);
        loopState = res.state;
        if (res.action === 'commit') applyScan(board);       // 새 상태 안정 확인 → 적용+계산
        else if (res.action === 'ambiguous') {
          const rs = gate.reasons.filter((r) => r !== 'notMyTurn');
          scan.status = `인식 애매(${rs.join(', ')}) — 확인 후 [다시 스캔]`;
        } else if (res.action === 'wait') scan.status = '인식 확인 중...';
        else if (!gate.isMyTurn) scan.status = '상대 턴 — 대기 중';
        return;
      }
      // 수동('다시 스캔'): 안정화 게이트 없이 강제 적용. 자동이 즉시 재커밋하지 않도록 커밋서명 동기화.
      if (board.rerollChoice) { handleRerollChoice(board); return; }
      applyScan(board);
      loopState.committedSig = boardSignature(board);
    };

    // ---- 리롤(밑장빼기) 두 주사위 선택 추천 ----
    let lastChoiceKey = null;
    let scanEpoch = 0; // 흐름 세대: 픽/스캔 적용마다 증가 — 뒤늦게 끝난 비동기 계산의 낡은 결과를 폐기
    async function handleRerollChoice(board) {
      const c = board.rerollChoice;
      const key = `${boardSignature(board)}|${c.orig}|${c.next}`;
      if (key === lastChoiceKey) return; // 자동 폴링(300ms) 중복 계산 방지
      lastChoiceKey = key;
      const epoch = ++scanEpoch;
      // 이 순간 리롤은 이미 소비됨 — 버튼 인식 결과 반영
      if (board.reroll) {
        if (board.reroll.me != null) ui.myMitjang = board.reroll.me;
        if (board.reroll.opp != null) ui.oppMitjang = board.reroll.opp;
      }
      const mapped = boardStateToSt(board);
      pushHistory();
      st.me = mapped.me;
      st.opp = mapped.opp;
      die.value = null;
      ui.selected = null;
      // 규칙상 리롤은 항상 다른 값 → 같은 값으로 읽혔다면 오인식이므로 추천하지 않음
      if (c.orig === c.next) {
        scan.status = '리롤 주사위 인식이 애매해요 — 화면에서 직접 확인하세요';
        return;
      }
      scan.status = `리롤 선택 계산 중... (${c.orig} vs ${c.next})`;
      try {
        const state = buildEngineState();
        const opts = { isBonus: false, seed: 1234567, precise: ui.precise, realAI: ui.realAI };
        const [ra, rb] = await Promise.all([
          solveAsync({ state, die: c.orig, opts }),
          solveAsync({ state, die: c.next, opts }),
        ]);
        if (epoch !== scanEpoch) return; // 계산 중 픽/새 스캔이 지나감 → 낡은 결과 버림
        const origProb = ra.best ? ra.best.winProb : 0;
        const nextProb = rb.best ? rb.best.winProb : 0;
        const pick = origProb >= nextProb ? c.orig : c.next;
        ui.rerollChoice = { orig: c.orig, next: c.next, origProb, nextProb, pick };
        scan.status = `리롤 선택: ${pick} 권장`;
      } catch (err) {
        if (epoch === scanEpoch) scan.status = '리롤 선택 계산 실패 — 직접 선택하세요';
      }
    }

    async function scanConnect() {
      try {
        captureHandle = await captureConnect();
        scan.connected = true;
        const frame = captureGrabFrame(captureHandle);
        if (savedRect && savedRect.capW === frame.width && savedRect.capH === frame.height) {
          scan.status = '자동 인식 켜짐 — 내 턴에 굴리면 자동 계산';
          autoStart();
        } else {
          if (savedRect) scan.status = '해상도/창이 달라졌어요 — 보정이 필요합니다';
          openCalibration(frame);
        }
      } catch (err) { scan.status = '화면 연결 취소/실패'; }
    }
    function recalibrate() {
      if (!scan.connected) return;
      try { openCalibration(captureGrabFrame(captureHandle)); }
      catch { scan.status = '프레임 캡처 실패 — 다시 연결'; scan.connected = false; }
    }
    function openCalibration(frame) {
      cal.frame = frame;
      cal.rect = savedRect ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
                           : { x: frame.width * 0.31, y: frame.height * 0.40, w: 979, h: 434 };
      cal.open = true;
      nextTick(() => renderCalibration());
    }
    function confirmCalibration() {
      savedRect = { ...cal.rect, capW: cal.frame.width, capH: cal.frame.height };
      localStorage.setItem(REC_KEY, JSON.stringify(savedRect));
      cal.open = false; cal.frame = null;
      scan.status = '보정 완료 — 자동 인식 켜짐';
      if (scan.connected) autoStart();
    }
    function cancelCalibration() { cal.open = false; cal.frame = null; }

    function scanDisconnect() {
      autoStop();
      if (overlay.on) closeOverlay(); // 오버레이는 화면공유 전용 — 공유 중지 시 함께 닫음(버튼도 사라지므로)
      if (captureHandle) captureDisconnect(captureHandle);
      captureHandle = null;
      scan.connected = false; scan.status = ''; scan.flags = null;
    }

    // ---- 연속 자동 루프 ----
    function pollAuto() {
      if (!auto.on || !scan.connected || scan.busy || cal.open || !savedRect) return;
      let frame;
      try { frame = captureGrabFrame(captureHandle); }
      catch (err) { scan.status = '프레임 캡처 실패 — 다시 연결'; scan.connected = false; autoStop(); return; }
      if (isBlackFrame(frame)) { scan.status = '검은 화면 — 테두리없는 창모드로'; return; }
      scan.busy = true; inflight = 'auto';
      const boardRect = { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h };
      visionWorker.postMessage({ buffer: frame.data.buffer, width: frame.width, height: frame.height, boardRect }, [frame.data.buffer]);
    }
    function autoStart() {
      loopState = createAutoloopState();
      rerollFlow = createRerollFlow();
      auto.on = true;
      if (loopTimer) clearInterval(loopTimer);
      loopTimer = setInterval(pollAuto, POLL_MS);
    }
    function autoStop() {
      auto.on = false;
      if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    }
    function scanNow() {
      if (!scan.connected || scan.busy) return;
      if (!savedRect) { scan.status = '먼저 보정하세요'; recalibrate(); return; }
      let frame;
      try { frame = captureGrabFrame(captureHandle); }
      catch (err) { scan.status = '프레임 캡처 실패 — 다시 연결'; scan.connected = false; return; }
      if (isBlackFrame(frame)) { scan.status = '검은 화면 — 테두리없는 창모드로'; return; }
      scan.busy = true; inflight = 'manual'; scan.status = '인식 중...';
      const boardRect = { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h };
      visionWorker.postMessage({ buffer: frame.data.buffer, width: frame.width, height: frame.height, boardRect }, [frame.data.buffer]);
    }

    function renderCalibration() {
      const cv = document.getElementById('calCanvas'); if (!cv || !cal.frame) return;
      const maxW = Math.min(900, window.innerWidth - 80);
      cal.scale = maxW / cal.frame.width;
      cal.dispW = Math.round(cal.frame.width * cal.scale);
      cal.dispH = Math.round(cal.frame.height * cal.scale);
      cv.width = cal.dispW; cv.height = cal.dispH;
      const ctx = cv.getContext('2d');
      const tmp = document.createElement('canvas'); tmp.width = cal.frame.width; tmp.height = cal.frame.height;
      tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cal.frame.data), cal.frame.width, cal.frame.height), 0, 0);
      ctx.drawImage(tmp, 0, 0, cal.dispW, cal.dispH);
      const L = computeLayout(cal.rect);
      ctx.fillStyle = '#00e0ff';
      const dot = (px, py) => { ctx.beginPath(); ctx.arc(px * cal.scale, py * cal.scale, 4, 0, 7); ctx.fill(); };
      for (const side of ['me', 'opp']) for (const line of L.cells[side]) for (const c of line) dot(c.cx, c.cy);
      ctx.fillStyle = '#ffd000'; dot(L.holdMine.cx, L.holdMine.cy); dot(L.holdOpp.cx, L.holdOpp.cy);
      const d = toDisplayRect(cal.rect, cal.scale);
      ctx.strokeStyle = '#ffd000'; ctx.lineWidth = 2; ctx.strokeRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#ffd000'; for (const hnd of handlesOf(d)) { ctx.fillRect(hnd.x - 5, hnd.y - 5, 10, 10); }
    }
    function calPointerDown(ev) {
      const cv = ev.currentTarget, r = cv.getBoundingClientRect();
      const pt = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const d = toDisplayRect(cal.rect, cal.scale);
      cal.dragging = hitTest(pt, d, 9); cal.last = pt;
    }
    function calPointerMove(ev) {
      if (!cal.dragging) return;
      const cv = ev.currentTarget, r = cv.getBoundingClientRect();
      const pt = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const ddx = (pt.x - cal.last.x) / cal.scale, ddy = (pt.y - cal.last.y) / cal.scale;
      cal.rect = applyDrag(cal.rect, cal.dragging, ddx, ddy);
      cal.last = pt; renderCalibration();
    }
    function calPointerUp() { cal.dragging = null; }
    function applyScan(board) {
      scanEpoch++; // 진행 중인 리롤 선택 계산이 있으면 그 결과는 폐기(흐름이 이미 지나감)
      const gate = scanGate(board);
      scan.flags = gate;
      // 밑장빼기(리롤) 버튼 상태 → 옵션 자동 반영 (내 턴 여부와 무관하게 항상 갱신)
      if (board.reroll) {
        if (board.reroll.me != null) ui.myMitjang = board.reroll.me;
        if (board.reroll.opp != null) ui.oppMitjang = board.reroll.opp;
      }
      if (!gate.isMyTurn) { scan.status = '내 턴이 아니에요(굴린 주사위가 없습니다)'; return; }
      const mapped = boardStateToSt(board);
      pushHistory();
      st.me = mapped.me;
      st.opp = mapped.opp;
      die.value = mapped.die || null;
      ui.bonusMode = mapped.bonusMode;
      ui.selected = null;
      ui.nextShield = false; // 스캔은 보드(실드 포함)를 직접 읽으므로 수동-배치 실드 힌트 해제
      if (gate.ok) { scan.status = `인식 완료(${scan.lastMs}ms) — 계산합니다`; solve(); }
      else { scan.status = `인식했지만 확인 필요(${gate.reasons.join(', ')}) — 노란 라인을 확인·수정 후 [추천] 하세요`; }
    }
    function scanRowWarn(li) {
      const f = scan.flags;
      if (!f || !f.lines) return false;
      const m = f.lines.me[li], o = f.lines.opp[li];
      return !!((m && (m.lowConf || m.impossible)) || (o && (o.lowConf || o.impossible)));
    }

    // ---- 오버레이(게임 위 항상 표시, 모니터 1개 사용자용) ----
    const overlay = reactive({ on: false });
    async function toggleOverlay() {
      if (overlay.on) { closeOverlay(); return; } // pagehide → onClosed에서 상태 정리
      if (!overlaySupported()) {
        scan.status = '오버레이는 크롬/엣지/웨일 최신 버전에서만 지원돼요';
        return;
      }
      try {
        await openOverlay({
          st, ui, scan, auto, die,
          sumOf, sumClass, rowRec, scanRowWarn, targetLabel, pct,
          canApplyAlkkagi, alkkagiLabel, applyAlkkagi, scanNow,
          isCloseCall, closeLeadPct,
          onClosed: () => { overlay.on = false; },
        });
        overlay.on = true;
      } catch (err) {
        console.error('overlay open failed:', err);
        scan.status = '오버레이 열기 실패 — 버튼을 다시 눌러주세요';
      }
    }

    // ---- 포맷 ----
    function pct(p) { return `${Math.round(p * 100)}%`; }
    function targetLabel(t) {
      return `${t.side === 'me' ? '내' : '상대'} 라인 ${t.lineIndex + 1}`;
    }
    function winColor(p) {
      if (p >= 0.6) return { color: 'var(--green)' };
      if (p <= 0.4) return { color: 'var(--red)' };
      return { color: 'var(--text)' };
    }
    function closeLeadPct(options) { return Math.round(topLead(options) * 100); }

    return {
      ...toRefs(st),
      die,
      ...toRefs(ui),
      canUndo, undo, clearAll, toggleInputCollapsed,
      selectSlot, setSlotValue, toggleSlotShield, clearSlot, clearSlotAt,
      sumOf, sumClass, slotText, slotClass, rowRec, selectedLabel, selectedIsNew,
      canApplyAlkkagi, alkkagiLabel, applyAlkkagi,
      solve, pct, targetLabel, winColor, isCloseCall, closeLeadPct,
      scan, auto, scanConnect, scanDisconnect, scanNow, scanRowWarn, recalibrate,
      overlay, toggleOverlay,
      cal, confirmCalibration, cancelCalibration, calPointerDown, calPointerMove, calPointerUp,
      guide, openGuide, closeGuide,
    };
  },
}).mount('#app');

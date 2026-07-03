// src/vision/autoloop.js — 연속 자동 루프의 결정 로직(순수). DOM/캡처와 분리해 단위 테스트 가능.
// 입력: toBoardState 결과 board + scanGate(board) 결과 gate. 출력: 취할 action.

const STABLE_FRAMES = 2; // 자동 커밋 전 동일 인식이 연속으로 일치해야 하는 프레임 수(튀는 프레임 배제)

export function boardSignature(board) {
  const lineSig = (line) => line.map((d) => `${d.value}${d.shield ? 's' : ''}`).join(',');
  const side = (lines) => lines.map(lineSig).join('|');
  return `me:${side(board.me)}#opp:${side(board.opp)}#die:${board.rolledDie || 0}#b:${board.bonusMode ? 1 : 0}`;
}

export function createAutoloopState() {
  return { pendingSig: null, pendingCount: 0, committedSig: null };
}

// action:
//   'idle'      — 상대 턴이거나 이미 커밋한 상태(아무 것도 안 함)
//   'wait'      — 내 턴이지만 아직 안정화 미달(대기)
//   'ambiguous' — 안정화됐지만 인식이 애매(clipped/impossible/lowConf) → 자동 커밋 보류
//   'commit'    — 자동 적용+계산
export function autoloopStep(state, board, gate, stableFrames = STABLE_FRAMES) {
  const s = { pendingSig: state.pendingSig, pendingCount: state.pendingCount, committedSig: state.committedSig };
  // 상대 턴/굴린 주사위 없음 → 대기. 안정화 카운터만 리셋, 커밋서명은 유지(복귀 시 새 상태면 재계산).
  if (!gate.isMyTurn) {
    s.pendingSig = null;
    s.pendingCount = 0;
    return { state: s, action: 'idle' };
  }
  const sig = boardSignature(board);
  // 이미 이 상태를 커밋함 → 재적용 안 함(중복 방지 + 사용자의 수동 수정 보호).
  if (sig === s.committedSig) {
    s.pendingSig = null;
    s.pendingCount = 0;
    return { state: s, action: 'idle' };
  }
  // 안정화: 같은 서명이 연속으로 와야 통과.
  if (sig === s.pendingSig) s.pendingCount += 1;
  else { s.pendingSig = sig; s.pendingCount = 1; }
  if (s.pendingCount < stableFrames) return { state: s, action: 'wait' };
  // 안정화 통과. 신뢰도 게이트가 막으면 자동 커밋 보류(쓰레기 자동 입력 방지).
  if (!gate.ok) return { state: s, action: 'ambiguous' };
  // 커밋.
  s.committedSig = sig;
  s.pendingSig = null;
  s.pendingCount = 0;
  return { state: s, action: 'commit' };
}

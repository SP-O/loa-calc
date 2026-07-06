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

// ── 리롤(밑장빼기) 선택 흐름 ──
// 두주사위 선택 상태가 표시된 뒤, 사용자가 하나를 고르면 화면은 클린 단일주사위(내 턴)로 돌아온다.
// 그 '픽' 프레임은 배치 추천을 반드시 다시 계산해야 한다. 문제: 두주사위 표시 중 새 주사위가
// 잠깐 중앙 블롭으로 잡혀(flicker) 픽 서명이 오토루프에 조기 커밋되면, 실제 픽이 '이미 커밋됨'으로
// idle 처리돼 추천이 안 나온다. → 선택을 본 뒤 첫 클린 내턴 프레임을 'pick'으로 신호해 강제 재계산.
export function createRerollFlow() {
  return { choosing: false, pendingPair: null, pendingCount: 0 };
}

// action:
//   'settling' — 두주사위가 보이지만 아직 안정화 전(도착/픽 애니메이션 중 구르는 면 오인 방지)
//   'choice'   — 같은 쌍이 연속 프레임으로 확인됨 → 선택 추천 계산
//   'pick'     — 선택 직후 첫 클린 내턴 → 강제 재계산(오토루프 조기 커밋 우회)
//   'none'
export function rerollFlowStep(state, board) {
  const c = board.rerollChoice;
  if (c) {
    const pair = `${c.orig}|${c.next}`;
    const count = pair === state.pendingPair ? state.pendingCount + 1 : 1;
    // choosing은 첫 목격부터 무장: 안정화 전에 유저가 픽해도(빠른 픽) pick 강제 재계산은 보장.
    const s = { choosing: true, pendingPair: pair, pendingCount: count };
    return { state: s, action: count >= 2 ? 'choice' : 'settling' };
  }
  // 선택을 봤고, 이제 클린 단일주사위 내 턴이 잡히면 그게 '픽'이다.
  if (state.choosing && board.isMyTurn && board.rolledDie) {
    return { state: createRerollFlow(), action: 'pick' };
  }
  // 아직 픽 전(주사위 정리 중 등, 내 턴 아님)이면 choosing 유지. 쌍 카운터는 리셋.
  return { state: { choosing: state.choosing, pendingPair: null, pendingCount: 0 }, action: 'none' };
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

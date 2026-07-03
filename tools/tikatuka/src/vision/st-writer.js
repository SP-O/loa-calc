// src/vision/st-writer.js — recognize/adapter 결과 → reactive st 대입형 + 자동적용 게이트. 순수(브라우저 전역 금지).

export function boardStateToSt(b) {
  return { me: b.me, opp: b.opp, die: b.rolledDie, bonusMode: b.bonusMode };
}

export function scanGate(b) {
  const reasons = [];
  if (!b.isMyTurn) reasons.push('notMyTurn');
  if (b.clipped) reasons.push('clipped');
  if (b.anyImpossible) reasons.push('impossible');
  if (b.anyLowConf) reasons.push('lowConf');
  return { ok: reasons.length === 0, reasons, clipped: b.clipped, isMyTurn: b.isMyTurn, lines: b.lines };
}

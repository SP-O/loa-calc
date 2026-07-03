// src/vision/adapter.js
export function packLine(spatial, side) {
  const order = side === 'me' ? [2, 1, 0] : [0, 1, 2];
  const filledFlags = spatial.map((c) => c && c.value > 0);
  const line = [];
  let minConf = Infinity;
  for (const idx of order) {
    const c = spatial[idx];
    if (c && c.value > 0) { line.push({ value: c.value, shield: !!c.shield }); minConf = Math.min(minConf, c.conf); }
  }
  let impossible = false, seenEmpty = false;
  for (const idx of order) { if (filledFlags[idx]) { if (seenEmpty) { impossible = true; break; } } else seenEmpty = true; }
  return { line, impossible, minConf: line.length ? minConf : Infinity };
}
export function toBoardState(rec) {
  const me = rec.cells.me.map((l) => packLine(l, 'me'));
  const opp = rec.cells.opp.map((l) => packLine(l, 'opp'));
  const CONF_MIN = 0.1; // 초기 임계(스펙 §7), 실측 보정
  const lowConf = (r) => !(r.minConf >= CONF_MIN); // NaN/Infinity 안전: Infinity>=2=true→false, NaN>=2=false→true
  const info = (rs) => rs.map((r) => ({ lowConf: lowConf(r), impossible: r.impossible }));
  const meInfo = info(me), oppInfo = info(opp);
  return {
    me: me.map((r) => r.line), opp: opp.map((r) => r.line),
    rolledDie: rec.rolledDie, isMyTurn: rec.isMyTurn, bonusMode: rec.bonusMode, clipped: rec.clipped,
    anyImpossible: [...meInfo, ...oppInfo].some((l) => l.impossible),
    anyLowConf: [...meInfo, ...oppInfo].some((l) => l.lowConf),
    lines: { me: meInfo, opp: oppInfo },
  };
}

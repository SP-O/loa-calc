export function lineSum(line) {
  const counts = {};
  for (const d of line) counts[d.value] = (counts[d.value] || 0) + 1;
  let sum = 0;
  for (const v in counts) {
    const c = counts[v];
    const val = Number(v);
    sum += c === 1 ? val : c === 2 ? 3 * val : 5 * val;
  }
  return sum;
}

export function lineResult(myLine, oppLine) {
  const a = lineSum(myLine);
  const b = lineSum(oppLine);
  return a > b ? 'me' : b > a ? 'opp' : 'draw';
}

export function boardTotal(board) {
  return board.lines.reduce((sum, line) => sum + lineSum(line), 0);
}

export function gameResult(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    const r = lineResult(state.me.lines[i], state.opp.lines[i]);
    if (r === 'me') me++;
    else if (r === 'opp') opp++;
  }
  if (me > opp) return 'me';
  if (opp > me) return 'opp';
  // 라인 승수 동률 → 세 필드 총합이 높은 쪽 승, 총합도 같으면 무승부
  const myTotal = boardTotal(state.me);
  const oppTotal = boardTotal(state.opp);
  if (myTotal > oppTotal) return 'me';
  if (oppTotal > myTotal) return 'opp';
  return 'draw';
}

export function outcomeValue(result) {
  return result === 'me' ? 1 : result === 'draw' ? 0.5 : 0;
}

// 게임 내 '홀드'(더 안 내고 버티기) 기준의 확정 결과.
// 상대 줄이 꽉 찼고 내가 앞서면 그 라인은 영구히 내 것: 상대는 꽉 차서 못 바꾸고,
// 알까기로 내 줄을 건드리지도 못하며(상대 줄에 자리 없음), 나는 홀드해 더 안 내면 됨.
// 이렇게 2라인을 잠그면 세 번째 라인·총합과 무관하게 승부가 결정된다.
export function decidedResult(state) {
  let me = 0;
  let opp = 0;
  for (let i = 0; i < 3; i++) {
    const a = lineSum(state.me.lines[i]);
    const b = lineSum(state.opp.lines[i]);
    if (state.opp.lines[i].length === 3 && a > b) me++;
    else if (state.me.lines[i].length === 3 && b > a) opp++;
  }
  if (me >= 2) return 'me';
  if (opp >= 2) return 'opp';
  return null;
}

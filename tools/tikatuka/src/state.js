export function createState({ oppHasMitjang = false, turn = 'me' } = {}) {
  return {
    me: { lines: [[], [], []], hasMitjang: true },
    opp: { lines: [[], [], []], hasMitjang: oppHasMitjang },
    turn,
  };
}

export function cloneState(state) {
  return {
    me: {
      lines: state.me.lines.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      hasMitjang: state.me.hasMitjang,
    },
    opp: {
      lines: state.opp.lines.map((l) => l.map((d) => ({ value: d.value, shield: d.shield }))),
      hasMitjang: state.opp.hasMitjang,
    },
    turn: state.turn,
  };
}

export function opponentOf(player) {
  return player === 'me' ? 'opp' : 'me';
}

export function boardFull(state) {
  return ['me', 'opp'].every((p) => state[p].lines.every((l) => l.length >= 3));
}

export function remainingEmpty(state) {
  let n = 0;
  for (const p of ['me', 'opp']) for (const l of state[p].lines) n += 3 - l.length;
  return n;
}

// 상태의 정준 키: 라인 인덱스를 (내·상대 함께) 순열해도 게임 가치는 불변이므로
// — 승부는 라인별 독립 비교 + 총합 타이브레이크라 라인 순서에 의미가 없다 —
// 라인 페어를 정렬해 같은 국면을 같은 키로 만든다(대칭 수 통합용).
export function canonicalKey(state) {
  const lineCode = (l) => {
    let a = 0, b = 0, c = 0;
    for (const d of l) {
      const v = d.shield ? d.value + 6 : d.value;
      if (v > a) { c = b; b = a; a = v; }
      else if (v > b) { c = b; b = v; }
      else if (v > c) { c = v; }
    }
    return (a * 13 + b) * 13 + c;
  };
  const pairs = [0, 1, 2].map((i) => lineCode(state.me.lines[i]) * 4096 + lineCode(state.opp.lines[i]));
  pairs.sort((x, y) => x - y);
  return `${pairs[0]},${pairs[1]},${pairs[2]}|${state.turn}|${state.me.hasMitjang ? 1 : 0}${state.opp.hasMitjang ? 1 : 0}`;
}

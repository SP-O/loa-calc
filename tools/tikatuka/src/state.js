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

import { cloneState, opponentOf } from './state.js';

export function lineSpace(line) {
  return 3 - line.length;
}

export function legalLines(state, player) {
  const out = [];
  for (let i = 0; i < 3; i++) if (state[player].lines[i].length < 3) out.push(i);
  return out;
}

export function emptyTargets(state) {
  const out = [];
  for (const side of ['me', 'opp']) {
    for (let i = 0; i < 3; i++) if (state[side].lines[i].length < 3) out.push({ side, lineIndex: i });
  }
  return out;
}

export function wouldTriggerAlkkagi(state, player, lineIndex, value) {
  const opp = opponentOf(player);
  const hasSpace = state[player].lines[lineIndex].length < 3;
  const hasMatch = state[opp].lines[lineIndex].some((d) => d.value === value && !d.shield);
  return hasSpace && hasMatch;
}

export function resolveAlkkagi(state, player, lineIndex, value) {
  const s = cloneState(state);
  const opp = opponentOf(player);
  s[opp].lines[lineIndex] = s[opp].lines[lineIndex].filter((d) => !(d.value === value && !d.shield));
  return s;
}

export function placeDie(state, player, lineIndex, die) {
  const s = cloneState(state);
  s[player].lines[lineIndex] = [...s[player].lines[lineIndex], { value: die.value, shield: !!die.shield }];
  return s;
}

export function endTurn(state) {
  const s = cloneState(state);
  s.turn = opponentOf(state.turn);
  return s;
}

export function setMitjang(state, player, value) {
  const s = cloneState(state);
  s[player].hasMitjang = value;
  return s;
}

export function rerollValues(value) {
  const out = [];
  for (let v = 1; v <= 6; v++) if (v !== value) out.push(v);
  return out;
}

// AlphaZero self-play: MCTS로 양쪽을 두며 학습 예제 수집.
// 예제 = { x: 입력, v: 최종결과(me 관점), pi: MCTS 방문분포(정책 타깃), mask }.
// 밑장빼기는 v1 액션공간 제외(both hasMitjang=false). 선공 랜덤 + 첫 주사위 실드.

import { createState, boardFull } from '../state.js';
import { gameResult, outcomeValue } from '../scoring.js';
import { legalLines, emptyTargets, wouldTriggerAlkkagi, resolveAlkkagi, placeDie, endTurn } from '../rules.js';
import { rollDie } from './evaluate.js';
import { azEncode, legalMask, actionToTarget } from './az-encode.js';
import { mctsSearch, sampleActionByVisits, visitPolicy } from './mcts.js';

export function selfPlayGame(net, rng, cfg = {}) {
  const sims = cfg.sims ?? 60;
  const temperature = cfg.temperature ?? 1.0;
  const noiseEps = cfg.noiseEps ?? 0.25;
  const turnCap = cfg.turnCap ?? 60;

  const state0 = createState({ turn: rng() < 0.5 ? 'me' : 'opp' });
  state0.me.hasMitjang = false;
  state0.opp.hasMitjang = false;
  let state = state0;
  const examples = [];
  let firstDie = true;
  let turns = 0;

  while (!boardFull(state) && turns < turnCap) {
    const mover = state.turn;
    if (legalLines(state, mover).length === 0) { state = endTurn(state); turns += 1; continue; }

    const die = rollDie(rng);
    const res = mctsSearch(net, state, 'normal', die, { sims, rng, mover, noiseEps });
    examples.push({ x: azEncode(state, 'normal', die), pi: visitPolicy(res.root), mask: legalMask(state, 'normal', mover) });
    const a = sampleActionByVisits(res.root, temperature, rng);
    const L = actionToTarget(a).lineIndex;

    if (wouldTriggerAlkkagi(state, mover, L, die)) {
      const s1 = resolveAlkkagi(state, mover, L, die);
      if (emptyTargets(s1).length === 0) { state = endTurn(s1); firstDie = false; turns += 1; continue; }
      const b = rollDie(rng);
      const bres = mctsSearch(net, s1, 'bonus', b, { sims, rng, mover, noiseEps });
      examples.push({ x: azEncode(s1, 'bonus', b), pi: visitPolicy(bres.root), mask: legalMask(s1, 'bonus', mover) });
      const ba = sampleActionByVisits(bres.root, temperature, rng);
      const t = actionToTarget(ba);
      state = endTurn(placeDie(s1, t.side, t.lineIndex, { value: b, shield: true }));
    } else {
      state = endTurn(placeDie(state, mover, L, { value: die, shield: firstDie }));
    }
    firstDie = false;
    turns += 1;
  }

  const z = outcomeValue(gameResult(state)); // me 관점 결과
  return { examples: examples.map((e) => ({ x: e.x, v: z, pi: e.pi, mask: e.mask })), turns, z };
}

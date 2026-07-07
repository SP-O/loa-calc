import { cloneState, boardFull } from '../state.js';
import { gameResult, outcomeValue, decidedResult } from '../scoring.js';
import { endTurn, placeDie, resolveAlkkagi, wouldTriggerAlkkagi, legalLines } from '../rules.js';
import { makeRng, rollDie, rerollDie, greedyMoveScored, greedyBonusTarget, aiOpponentMove, chooseScore } from './evaluate.js';

const ROLLOUT_CAP = 40;
// 밑장(리롤) 발동 문턱: 이번 굴림의 최선 수가 '두기 전 형세'보다 이만큼 나쁘면
// 리롤하고, 원래 주사위와 새 주사위 중 좋은 쪽을 택한다(게임 규칙과 동일).
const REROLL_MARGIN = 0.02;

// opts.realAI: 상대('opp') 턴은 실제 AI 흉내 정책으로 둠(실전 승률 반영).
// 성능: 시작 시 1회만 복제(cloneState)하고 이후 모든 수는 소유 클론에 제자리 적용.
// 수 하나당 보드 전체 복제 2회(placeDie+endTurn)를 없애 롤아웃 처리량을 키운다.
export function rollout(state, rng, opts = {}) {
  const s = cloneState(state);
  let depth = 0;
  while (!boardFull(s) && depth < ROLLOUT_CAP) {
    // 홀드: 2라인이 잠겨 승부가 이미 결정났으면 더 진행하지 않고 즉시 결과 반환.
    // (그리디 정책이 잠긴 라인을 자해 알까기로 헌납하는 것을 방지)
    const decided = decidedResult(s);
    if (decided) return outcomeValue(decided);
    const player = s.turn;
    const next = player === 'me' ? 'opp' : 'me';
    // 상대가 먼저 꽉 차도 게임은 판 전체가 찰 때까지 계속된다("game ends when full").
    // 둘 곳 없는 플레이어는 턴만 넘기고, 빈칸 남은 플레이어가 계속 둔다.
    if (legalLines(s, player).length === 0) { s.turn = next; depth++; continue; }
    let die = rollDie(rng);
    let move;
    if (opts.realAI && player === 'opp') {
      // 실AI 상대는 밑장을 모델링하지 않는다(무지성 알까기 성향 유지)
      move = aiOpponentMove(s, die, rng);
    } else {
      let scored = greedyMoveScored(s, die, rng);
      // 밑장: 남아 있고 이번 굴림이 형세를 문턱 이상 깎으면 리롤 → 둘 중 좋은 주사위 선택
      if (scored && s[player].hasMitjang && scored.score < chooseScore(player, s) - REROLL_MARGIN) {
        s[player].hasMitjang = false; // rollout 소유 클론이므로 직접 소비 표기
        const r2 = rerollDie(rng, die); // 규칙: 새 주사위는 원래 값이 절대 안 나옴
        const scored2 = greedyMoveScored(s, r2, rng);
        if (scored2 && scored2.score > scored.score) { scored = scored2; die = r2; }
      }
      move = scored && scored.move;
    }
    if (!move) { s.turn = next; depth++; continue; }
    if (move.alkkagi) {
      const L = move.lineIndex;
      s[next].lines[L] = s[next].lines[L].filter((d) => !(d.value === die && !d.shield));
      const b = rollDie(rng);
      const t = greedyBonusTarget(s, player, b, rng);
      if (t) s[t.side].lines[t.lineIndex].push({ value: b, shield: true });
    } else {
      s[player].lines[move.lineIndex].push({ value: die, shield: false });
    }
    s.turn = next;
    depth++;
  }
  return outcomeValue(gameResult(s));
}

// opts.pairBase: 공통 난수 페어링(CRN). 설정 시 k번째 롤아웃이 makeRng(pairBase+k)를
// 쓰므로, 같은 pairBase로 평가한 서로 다른 후보들은 k번째 롤아웃에서 동일한 주사위
// 흐름을 겪는다 → 후보 간 '차이'의 분산이 크게 줄어 근소차 순위가 안정된다.
export function montecarloValue(state, n, rng, opts = {}) {
  let total = 0;
  for (let k = 0; k < n; k++) {
    const r = opts.pairBase != null ? makeRng(opts.pairBase + k) : rng;
    total += rollout(state, r, opts);
  }
  return total / n;
}

export function mcMyPlacementValue(state, lineIndex, value, n, rng, opts = {}) {
  if (wouldTriggerAlkkagi(state, 'me', lineIndex, value)) {
    // 알까기 해석은 결정적 → 루프 밖에서 1회. 반복마다는 보너스 배치만 달라진다.
    const s1 = resolveAlkkagi(state, 'me', lineIndex, value);
    const s1End = endTurn(s1); // 보너스 둘 곳이 없을 때 재사용(rollout이 입력을 복제하므로 안전)
    let total = 0;
    for (let k = 0; k < n; k++) {
      const r = opts.pairBase != null ? makeRng(opts.pairBase + k) : rng;
      const b = rollDie(r);
      const t = greedyBonusTarget(s1, 'me', b, r);
      if (t) {
        const placed = placeDie(s1, t.side, t.lineIndex, { value: b, shield: true });
        placed.turn = 'opp'; // placeDie가 준 소유 복제본이라 직접 수정 안전
        total += rollout(placed, r, opts);
      } else {
        total += rollout(s1End, r, opts);
      }
    }
    return total / n;
  }
  const s = endTurn(placeDie(state, 'me', lineIndex, { value, shield: false }));
  return montecarloValue(s, n, rng, opts);
}

export function mcBonusPlacementValue(state, target, value, n, rng, opts = {}) {
  const s = endTurn(placeDie(state, target.side, target.lineIndex, { value, shield: true }));
  return montecarloValue(s, n, rng, opts);
}

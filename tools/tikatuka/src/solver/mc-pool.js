// 멀티코어 MC 평가기(워커 풀): 한 평가의 롤아웃 [0, n)을 청크로 쪼개 서브워커들에
// 분배한다. pairBase 범위합은 분할 경계와 무관하게 순차 계산과 완전히 동일한 값을
// 주므로, 풀을 쓰든 안 쓰든 추천 결과는 같고 속도만 코어 수만큼 빨라진다.
//
// 사용처: worker.js(솔버 코디네이터 워커)가 서브워커를 띄우는 "중첩 워커" 구조.
// 중첩 워커 미지원/실패 환경은 initMcPool()이 null을 반환 → 순차 평가기로 폴백.

export async function initMcPool(timeoutMs = 4000) {
  if (typeof Worker !== 'function') return null;
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  // 코디네이터 워커·메인 스레드(UI/화면인식) 몫으로 1코어 남기고, 과도한 워커는 이득이 없어 6개로 캡
  const size = Math.min(Math.max(1, hc - 1), 6);
  if (size < 2) return null; // 1개면 병렬 이득 없음 → 순차 경로가 오버헤드 없이 낫다

  let workers = [];
  try {
    for (let i = 0; i < size; i++) {
      workers.push(new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' }));
    }
  } catch {
    for (const w of workers) { try { w.terminate(); } catch { /* noop */ } }
    return null;
  }

  let msgId = 0;
  const pending = new Map();
  for (const w of workers) {
    w.onmessage = (e) => {
      const { id, sum, error } = e.data;
      const cb = pending.get(id);
      if (!cb) return;
      pending.delete(id);
      if (error) cb.reject(new Error(error));
      else cb.resolve(sum);
    };
  }

  let rr = 0; // 라운드로빈 분배 — 청크 크기가 균일해 이 정도로 부하가 고르게 퍼진다
  const dispatch = (payload) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    workers[rr++ % workers.length].postMessage({ id, ...payload });
  });

  // 핸드셰이크: 서브워커가 실제로 로드·응답하는지 확인(중첩 워커 미지원 브라우저 방어).
  try {
    await Promise.race([
      Promise.all(workers.map((w, i) => dispatch({ kind: 'ping' }))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('mc-pool handshake timeout')), timeoutMs)),
    ]);
  } catch {
    for (const w of workers) { try { w.terminate(); } catch { /* noop */ } }
    return null;
  }

  const split = async (payload, n) => {
    const chunk = Math.ceil(n / workers.length);
    const parts = [];
    for (let k0 = 0; k0 < n; k0 += chunk) {
      parts.push(dispatch({ ...payload, k0, k1: Math.min(n, k0 + chunk) }));
    }
    const sums = await Promise.all(parts);
    let total = 0;
    for (const s of sums) total += s;
    return total / n;
  };

  return {
    concurrency: workers.length,
    my: (state, lineIndex, die, n, pairBase, mcOpts) =>
      split({ kind: 'my', state, lineIndex, die, pairBase, mcOpts }, n),
    bonus: (state, target, die, n, pairBase, mcOpts) =>
      split({ kind: 'bonus', state, target, die, pairBase, mcOpts }, n),
    destroy: () => { for (const w of workers) { try { w.terminate(); } catch { /* noop */ } } },
  };
}

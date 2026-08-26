# 도스터 합체 연출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 푸터에 쌓인 도스터에 새 도스터가 떨어질 때 낮은 확률로 뭉쳐 큰 도스터가 되고, 보고 있는 동안 15초를 살다 터지면서 도로 흩어지는 연출을 넣는다.

**Architecture:** 기존 `dosters` Map은 구조를 바꾸지 않고 `blobs` Map을 따로 얹는다. 합체된 멤버는 삭제하지 않고 `body = null` + `display:none` + `blobId` 표식으로 재우며, Map에 남겨 퇴장·도망이 계속 key로 대상을 찾게 한다. `body = null` 하나로 기존 가드 5곳이 자동으로 걸러지므로 물리 코드 본체는 손대지 않는다. Firebase에는 아무것도 쓰지 않는 완전 로컬 연출이다.

**Tech Stack:** 순수 IIFE JavaScript (ES5 문법, `var`), Matter.js, Web Animations API, CSS 키프레임, IntersectionObserver. 빌드 단계 없음.

## Global Constraints

- **커밋·푸시는 사용자가 직접 한다.** Claude는 `git add`까지만. `Co-Authored-By` 트레일러 금지. 따라서 태스크마다 커밋하지 않고, 마지막 Task 10에서 한 번에 넘긴다.
- **작업 폴더는 git 저장소가 아니다.** 운영 폴더(`문서\loa-calc`) 동기화는 사용자의 명시적 허가 전까지 금지.
- 코드 스타일: 기존 파일과 동일하게 `var`, 함수 선언, ES5. 화살표 함수·`let`·`const`·템플릿 리터럴을 쓰지 않는다.
- **주석은 진짜 필요한 것만.** "왜 이렇게 했는지"가 코드에서 안 읽히는 곳에만 단다.
- 사용자 노출 문구가 생기면 인게임 용어만 사용한다.
- 대상 파일은 `assets/easter-egg.js`, `assets/easter-egg.css` 두 개뿐이다. `index.html`은 캐시 버스터(`?v=`)만 바꾼다.

## 파일 구조

| 파일 | 역할 | 이번에 추가되는 것 |
|---|---|---|
| `assets/easter-egg.js` | 이스터에그 전체 (IIFE) | 합체 상수·`blobs` Map·판정·생성·분해·수명·클릭·연출 (약 200줄) |
| `assets/easter-egg.css` | 스테이지 스타일 | `.ee-blob` 규칙, 금색 반짝·blob idle 키프레임 (약 20줄) |
| `index.html` | 캐시 버스터 | `easter-egg.js?v=` / `easter-egg.css?v=` 날짜 갱신 |
| 하네스 (스크래치패드) | 가짜 Firebase 테스트 | `removeKey` / `fleeKey` / `blobStat` 조작 API |

`easter-egg.js`는 이미 1,278줄이지만 분리하지 않는다. 단일 IIFE 안에서 클로저 상태(`dosters`, `world`, `stage`)를 공유하는 구조라, 파일을 쪼개면 그 상태를 전역에 노출해야 해서 오히려 나빠진다. 합체 코드는 기존 구획 주석 방식(`═══ 섹션명 ═══`)을 따라 한 블록으로 모은다.

## 하네스

```
C:/Users/sangb/AppData/Local/Temp/claude/C--Users-sangb-OneDrive-------0622----------------/460ac1a7-fee7-423f-883a-30458b2f45f5/scratchpad/_eastertest.html
```

이 파일은 실제 `easter-egg.js`를 그대로 불러오되 Firebase만 가짜로 물린 것이라, 여기서 통과하면 화면과 어긋날 수 없다. 실행은 프로젝트 루트에 복사한 뒤 `preview_start`로 띄우고, **측정이 끝나면 반드시 스크래치패드로 되돌린다**(프로젝트·배포 폴더에 남기지 않는다).

**브라우저 뷰포트를 반드시 데스크톱으로 맞춘다.** 기본 폭이 391px이면 `isMobile()`이 참이 되어 이스터에그가 통째로 꺼진다.

```
resize_window { preset: "desktop" }
```

**측정마다 캐시를 무효화한다.** 하네스의 `<script src="/assets/easter-egg.js?v=...">`에서 `?v=` 값을 바꾸고 새로고침한다. 브라우저가 예전 파일을 물고 있으면 측정이 통째로 무의미해진다(과거에 이 때문에 A/B 비교 한 건을 날린 적이 있다).

---

### Task 1: 하네스에 조작 API 추가 + 기준선 측정

이후 모든 태스크가 이 API와 기준선 숫자를 쓴다.

**Files:**
- Modify: `<스크래치패드>/_eastertest.html` — 테스트 조작 API 블록, `window.clearAll` 바로 앞

**Interfaces:**
- Produces: `window.removeKey(k)`, `window.fleeKey(k, dir)`, `window.blobStat()`

- [ ] **Step 1: 퇴장·도망 주입 API를 추가한다**

`window.clearAll = function () {` 바로 앞에 넣는다.

```javascript
  // 접속자 퇴장을 흉내낸다 — blob 분해 트리거 검증용
  window.removeKey = function (k) {
    if (users[k]) { delete users[k]; fire('child_removed', k, null); }
  };
  // 다른 사람이 내 화면의 도스터를 클릭한 상황을 흉내낸다
  window.fleeKey = function (k, dir) {
    if (!users[k]) return;
    users[k].flee = { dir: dir || 'left', t: Date.now() };
    fire('child_changed', k, users[k]);
  };
```

- [ ] **Step 2: blob 상태를 읽는 API를 추가한다**

같은 자리에 이어서 넣는다. 아직 `.ee-blob`은 존재하지 않으므로 지금은 늘 0을 돌려준다 — 정상이다.

```javascript
  // 측정용 — blob 개수·크기·푸터 이탈을 한 번에 읽는다
  window.blobStat = function () {
    var st = document.getElementById('easter-egg-stage');
    var foot = document.querySelector('footer').getBoundingClientRect();
    var out = [];
    st.querySelectorAll('.ee-blob').forEach(function (b) {
      var r = b.getBoundingClientRect();
      out.push({
        w: Math.round(r.width),
        outside: (r.left < foot.left - 1 || r.right > foot.right + 1),
        aboveStage: Math.round(foot.top - r.bottom) > 120,
        clickable: getComputedStyle(b).pointerEvents !== 'none'
      });
    });
    return { count: out.length, items: out, dosters: st.querySelectorAll('.ee-doster').length };
  };
```

- [ ] **Step 3: 하네스를 프로젝트 루트에 복사하고 띄운다**

```bash
cp "<스크래치패드>/_eastertest.html" "<프로젝트>/_eastertest.html"
```

`preview_start`로 띄운 뒤 `resize_window { preset: "desktop" }`, 그다음 `navigate`로 `/_eastertest.html`.

- [ ] **Step 4: API가 붙었는지 확인한다**

`javascript_tool`로 실행:

```javascript
await ready();
[typeof removeKey, typeof fleeKey, typeof blobStat, blobStat().count]
```

기대: `["function","function","function",0]`

- [ ] **Step 5: 커서 밀기 기준선을 측정한다 (Task 2에서 이 값을 맞춰야 한다)**

도스터 하나를 떨어뜨려 재운 뒤, 커서를 옆에 갖다 대고 얼마나 밀리는지 잰다.

```javascript
await ready(); clearAll(); spawnAt(0.5);
await new Promise(function(r){ setTimeout(r, 4000); });
var el = document.querySelector('.ee-doster');
var x0 = parseFloat(el.style.left);
var r = document.getElementById('easter-egg-stage').getBoundingClientRect();
for (var i = 0; i < 20; i++) {
  window.dispatchEvent(new MouseEvent('mousemove',
    { clientX: r.left + parseFloat(el.style.left) - 30, clientY: r.bottom - 20 }));
  await new Promise(function(res){ setTimeout(res, 50); });
}
Math.round(parseFloat(el.style.left) - x0)
```

기대: 0보다 큰 값(오른쪽으로 밀림). **이 숫자를 기록해 Task 2의 목표로 삼는다.**

---

### Task 2: 커서 밀기에 무게를 반영한다

기존 코드의 문제다. blob과 무관하게 고칠 값어치가 있고, 독립적으로 검증된다.

**Files:**
- Modify: `assets/easter-egg.js:879` (`PUSH_FORCE` 상수)
- Modify: `assets/easter-egg.js:907` (`power` 계산)

**Interfaces:**
- Consumes: Task 1 Step 5의 기준선 픽셀 값
- Produces: 없음 (기존 동작 교정)

- [ ] **Step 1: 질량 곱을 제거한다**

`handleGlobalMouseMove` 안의 이 줄을

```javascript
            var power = (1 - dist / reach) * PUSH_FORCE * d.body.mass;
```

이렇게 바꾼다.

```javascript
            // 힘에 질량을 곱하면 가속도가 질량과 무관해져, 5배 무거운 blob 도 솜털처럼 밀린다
            var power = (1 - dist / reach) * PUSH_FORCE;
```

- [ ] **Step 2: 밀리는 정도가 기존과 같아지도록 PUSH_FORCE를 올린다**

가속도가 `1/질량`으로 바뀌었으므로 그대로 두면 모두가 덜 밀린다. 상수를 올려 보통 도스터의 밀림이 기준선과 같아지게 맞춘다.

```javascript
    var PUSH_FORCE = 0.003;     // 질량 곱을 뺀 만큼 올린 값 — 보통 도스터 기준
```

- [ ] **Step 3: 다시 측정해 기준선과 맞는지 본다**

하네스 `?v=`를 갱신해 새로고침한 뒤, Task 1 Step 5와 **똑같은 스크립트**를 다시 돌린다.

기대: 기준선의 **±25% 안**. 벗어나면 `PUSH_FORCE`를 비례 조정하고 다시 잰다.

- [ ] **Step 4: 무거운 도스터가 덜 밀리는지 확인한다**

밀도 개체차(0.85~1.15배)가 이제 화면에 드러나야 한다.

```javascript
await ready(); clearAll();
for (var i = 0; i < 8; i++) spawnAt(0.2 + i * 0.07);
await new Promise(function(r){ setTimeout(r, 6000); });
var r = document.getElementById('easter-egg-stage').getBoundingClientRect();
var els = [].slice.call(document.querySelectorAll('.ee-doster'));
var before = els.map(function(e){ return parseFloat(e.style.left); });
for (var i = 0; i < 30; i++) {
  window.dispatchEvent(new MouseEvent('mousemove',
    { clientX: r.left + r.width * 0.5, clientY: r.bottom - 20 }));
  await new Promise(function(res){ setTimeout(res, 40); });
}
els.map(function(e, i){ return Math.round(Math.abs(parseFloat(e.style.left) - before[i])); })
```

기대: 값들이 **서로 다르다**. 전부 같으면 질량이 여전히 상쇄되고 있다는 뜻이다.

---

### Task 3: 합체 상수 + 벽 여백을 최대 크기 기준으로

큰 도스터가 만들어지기 전에 해 둔다. 안 그러면 첫 합체가 곧바로 푸터 밖으로 삐져나온다.

**Files:**
- Modify: `assets/easter-egg.js:30` 뒤 (상수 블록 추가)
- Modify: `assets/easter-egg.js:203-205` (`updatePhysicsBounds`의 inset 계산)

**Interfaces:**
- Produces: `MERGE_RADIUS`, `MERGE_MAX`, `MERGE_P5`, `MERGE_P4`, `BLOB_LIFE_MS`, `NEARMISS_GAP_MS`, `BURST_FORCE`

- [ ] **Step 1: 합체 상수 블록을 만든다**

`PHYSICS` 선언 바로 뒤에 넣는다.

```javascript
    // 합체 연출
    var MERGE_RADIUS = 60;      // 화면 px — 맞닿은 이웃만 잡히는 거리
    var MERGE_MAX = 5;          // 한 번에 합칠 수 있는 최대 마리 수
    var MERGE_P5 = 0.12;        // 5마리 이상 모였을 때
    var MERGE_P4 = 0.05;        // 정확히 4마리
    var BLOB_LIFE_MS = 15000;
    var NEARMISS_GAP_MS = 3000;
    var BURST_FORCE = 0.018;    // 터질 때 바깥으로 미는 힘 (잭팟 0.012~0.025 와 같은 규모)
```

- [ ] **Step 2: inset을 최대 크기 기준으로 바꾼다**

`updatePhysicsBounds` 안의 이 세 줄을

```javascript
        var half = dosterW(0) / 2;
        var bodyHalf = toLocal(DOSTER_PHYS_R[0]) * 1.7 / 2;   // 바디 반너비
        var inset = (half - bodyHalf) + half * (Math.SQRT2 - 1);
```

이렇게 바꾼다.

```javascript
        // 합체한 큰 도스터(최대 sqrt(5)배)까지 푸터 선 안에 가두려면 그 크기로 여백을 잡아야 한다
        var grow = Math.sqrt(MERGE_MAX);
        var half = dosterW(0) * grow / 2;
        var bodyHalf = toLocal(DOSTER_PHYS_R[0]) * 1.7 * grow / 2;
        var inset = (half - bodyHalf) + half * (Math.SQRT2 - 1);
```

- [ ] **Step 3: 여백이 실제로 넓어졌는지 확인한다**

```javascript
await ready(); clearAll();
for (var i = 0; i < 26; i++) spawn(1);
await new Promise(function(r){ setTimeout(r, 8000); });
var st = document.getElementById('easter-egg-stage').getBoundingClientRect();
var xs = [].slice.call(document.querySelectorAll('.ee-doster')).map(function(e){
  var r = e.getBoundingClientRect();
  return [Math.round(r.left - st.left), Math.round(st.right - r.right)];
});
[Math.min.apply(null, xs.map(function(a){ return a[0]; })),
 Math.min.apply(null, xs.map(function(a){ return a[1]; }))]
```

기대: 양쪽 최소 여백이 **20 이상**(기존은 약 6~8). 음수가 나오면 푸터 밖으로 나간 것이다.

---

### Task 4: 합체 판정 — 검출만 (blob 생성 없이)

확률이 맞는지 먼저 증명한다. 생성·연출을 같이 넣으면 확률이 틀렸는지 연출이 틀렸는지 구분이 안 된다.

**Files:**
- Modify: `assets/easter-egg.js` — `syncDosterPositions` 위에 새 섹션 추가
- Modify: `assets/easter-egg.js:417-420` — 착지 분기에 호출 한 줄

**Interfaces:**
- Consumes: `MERGE_RADIUS`, `MERGE_MAX`, `MERGE_P5`, `MERGE_P4` (Task 3)
- Produces: `tryMerge(key, d)` — 합체 대상 key 배열을 정하고 확률을 굴린다. 이 태스크에서는 `window.__mergeLog`에 기록만 한다.

- [ ] **Step 1: 판정 함수를 넣는다**

`// ═══ DOM RENDERING` 위, `schedulePosture` 다음에 새 섹션으로 추가한다.

```javascript
    // ═══════════════════════════════════════════
    //  합체 연출
    // ═══════════════════════════════════════════
    var blobs = new Map();
    var blobSeq = 0;
    var lastNearMiss = 0;

    // 도스터가 잠들어 landed 가 붙는 순간 한 번만 부른다.
    // 매 프레임 그룹 판정을 돌리지 않으려고 트리거를 이 시점으로 고정했다.
    function tryMerge(key, d) {
        if (blobs.size > 0) return;          // blob 은 한 번에 하나
        if (!d.body) return;
        var reach = toLocal(MERGE_RADIUS);
        var p = d.body.position;
        var near = [];
        dosters.forEach(function (o, k) {
            if (k === key || !o.body || o.blobId || o.fleeing || !o.landed) return;
            var dx = o.body.position.x - p.x, dy = o.body.position.y - p.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= reach) near.push({ k: k, dist: dist });
        });

        var k = near.length + 1;
        if (k < 4) return;
        near.sort(function (a, b) { return a.dist - b.dist; });
        var keys = [key];
        var take = Math.min(k, MERGE_MAX) - 1;
        for (var i = 0; i < take; i++) keys.push(near[i].k);

        var prob = (k >= MERGE_MAX) ? MERGE_P5 : MERGE_P4;
        var hit = Math.random() < prob;
        if (window.__mergeLog) window.__mergeLog.push({ k: k, n: keys.length, hit: hit });
        if (!hit) return;
        // Task 5 에서 createBlob(keys, d.type, p.x, p.y + (d.body.halfH || 0)) 로 교체한다
    }
```

- [ ] **Step 2: 착지 순간에 연결한다**

`syncDosterPositions` 안의 이 블록을

```javascript
            var sleeping = d.body.isSleeping;
            if (sleeping && !d.landed) {
                d.landed = true;
                d.el.classList.add('landed');
            }
```

이렇게 바꾼다.

```javascript
            var sleeping = d.body.isSleeping;
            if (sleeping && !d.landed) {
                d.landed = true;
                d.el.classList.add('landed');
                tryMerge(key, d);
            }
```

- [ ] **Step 3: 확률이 수렴하는지 잰다 (5마리 경로)**

```javascript
window.__mergeLog = [];
await ready();
for (var t = 0; t < 40; t++) {
  clearAll();
  await new Promise(function(r){ setTimeout(r, 300); });
  for (var i = 0; i < 6; i++) { spawnAt(0.5); await new Promise(function(r){ setTimeout(r, 900); }); }
  await new Promise(function(r){ setTimeout(r, 2500); });
}
var five = window.__mergeLog.filter(function(m){ return m.k >= 5; });
[five.length,
 five.filter(function(m){ return m.hit; }).length,
 (five.filter(function(m){ return m.hit; }).length / five.length * 100).toFixed(1) + '%']
```

기대: 표본 **60건 이상**, 적중률 **12% ± 8%p**. 표본이 40건 미만이면 반복 횟수를 늘린다.

`javascript_tool`이 30초에서 끊기므로, 40회를 한 번에 돌리지 말고 10회씩 네 번에 나눠 실행한다(`window.__mergeLog`는 유지된다).

- [ ] **Step 4: 합칠 마리 수가 상한을 넘지 않는지 확인한다**

```javascript
window.__mergeLog.map(function(m){ return m.n; }).filter(function(n){ return n > 5 || n < 4; })
```

기대: `[]`. 4나 5가 아닌 값이 하나라도 있으면 `take` 계산이 틀린 것이다.

- [ ] **Step 5: 흩어져 있으면 판정이 안 열리는지 확인한다**

```javascript
window.__mergeLog = [];
await ready(); clearAll();
for (var i = 0; i < 5; i++) { spawnAt(0.1 + i * 0.2); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
window.__mergeLog.length
```

기대: `0`. 서로 60px 넘게 떨어져 있으므로 아무 판정도 일어나면 안 된다.

---

### Task 5: blob 생성 — 멤버 재우기·물리 바디·렌더·연동

**Files:**
- Modify: `assets/easter-egg.js:211-241` — `createDosterBody`를 `makeDosterBody`로 분리
- Modify: `assets/easter-egg.js` 합체 섹션 — `createBlobEl`, `createBlob`, `syncBlobPositions` 추가
- Modify: `assets/easter-egg.js:118-119`(충돌), `:845`(idle), `:1102`(잭팟), `:535`(렌더), `:952`(종료)
- Modify: `assets/easter-egg.css:24` 뒤 — `.ee-blob` 규칙

**Interfaces:**
- Consumes: `tryMerge`(Task 4), `MERGE_MAX`(Task 3)
- Produces:
  - `makeDosterBody(x, y, type)` → Matter body (월드에 이미 추가됨, `halfH` 세팅됨)
  - `createBlob(keys, type, cx, bottomY)` → 없음
  - `blobs` 항목: `{ id, body, el, inner, type, memberKeys[], clicks, remainMs, lastTick, idleTimer, dissolving }`
  - `handleBlobClick(id)`를 참조한다 — Task 8에서 정의한다. 그 전까지 blob을 클릭하면 아무 일도 일어나지 않는 것이 정상이다.

- [ ] **Step 1: 도스터 바디 생성을 재사용 가능한 형태로 쪼갠다**

분해할 때 임의 좌표에 바디를 되살려야 한다. `createDosterBody`의 본문을 `makeDosterBody`로 옮기고, 기존 함수는 그것을 부르게 한다. 기존 주석(원·정사각형이 안 되는 이유, 개체차, 관성, sleepThreshold)은 `makeDosterBody`로 함께 옮긴다.

```javascript
    // 좌표를 직접 받아 바디를 만든다 — 낙하 진입과 분해 복원이 같이 쓴다.
    // 원은 굴러 미끄러져 층이 안 쌓이고, 정사각형은 옆으로 누운 자세도 똑같이 안정적이라
    // 스스로 일어나지 못한다. 가로로 납작한 형태라야 바로 선 자세가 유일하게 안정적이다.
    function makeDosterBody(x, y, type) {
        var s = toLocal(DOSTER_PHYS_R[type] || DOSTER_PHYS_R[0]) * 1.7;
        var bh = s * 0.72;
        // 개체차 — 잘 튀는 애와 묵직한 애가 섞여야 지켜보는 재미가 산다
        var body = Matter.Bodies.rectangle(x, y, s, bh, {
            chamfer: { radius: bh * 0.3 },
            restitution: 0.55 + Math.random() * 0.3,
            friction: PHYSICS.friction,
            frictionAir: PHYSICS.frictionAir,
            density: PHYSICS.density * (0.85 + Math.random() * 0.3)
        });
        // 회전 관성을 키워 잘 구르지 않게 한다. 다만 너무 키우면 부딪혀도 뻣뻣해 보인다 —
        // 자리를 잡은 뒤 자세를 스스로 고치므로(schedulePosture) 어느 정도 구르는 건 허용한다.
        Matter.Body.setInertia(body, body.inertia * 8);
        // 사각형은 접촉점이 많아 기본 문턱(60프레임)으로는 잠들기까지 한참 걸린다.
        // 늦게 잠들면 landed 가 늦게 붙어 그동안 클릭이 되지 않는다.
        body.sleepThreshold = 30;
        body.halfH = bh / 2;   // 스프라이트 하단을 바닥에 맞추는 데 쓴다
        Matter.Composite.add(world, body);
        return body;
    }

    // 연출 낙하가 끝나는 순간의 속도를 물리로 그대로 넘긴다.
    // 0 으로 시작하면 다 내려와서 갑자기 멈춘 뒤 무중력처럼 스르르 내려앉는다.
    var ENTRY_SPEED_CAP = 17;   // px/스텝 — 바닥(60px)을 한 스텝에 뚫지 않는 선
    function createDosterBody(normalizedX, type, entrySpeed) {
        var w = stage ? stage.offsetWidth : window.innerWidth;
        var body = makeDosterBody(normalizedX * w, -40, type);
        var vy = Math.min((entrySpeed || 0) * FIXED_DELTA, ENTRY_SPEED_CAP);
        Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: vy });
        Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
        return body;
    }
```

- [ ] **Step 2: blob 요소를 만드는 함수를 넣는다**

```javascript
    // ee-doster 클래스를 붙이지 않는다 — 도스터 폭 규칙(40px)을 상속받지 않으려는 것
    function createBlobEl(id, type, w, hasMine) {
        var el = document.createElement('div');
        el.className = 'ee-char ee-blob';
        el.setAttribute('data-blob', id);
        if (hasMine) el.classList.add('ee-mine');
        el.style.width = w + 'px';
        el.style.left = '-200px';
        el.style.bottom = STAGE_HEIGHT + 'px';

        var img = document.createElement('img');
        img.src = type === 0 ? 'object/doster_a.png' : 'object/doster_b.png';
        img.className = 'ee-doster-body ee-blob-body';
        img.draggable = false;
        el.appendChild(img);

        el.addEventListener('click', function (e) {
            e.stopPropagation();
            handleBlobClick(id);
        });
        stage.appendChild(el);
        return el;
    }
```

- [ ] **Step 3: 합체 본체를 넣는다**

```javascript
    function createBlob(keys, type, cx, bottomY) {
        var n = keys.length;
        var id = 'b' + (++blobSeq);
        var hasMine = keys.indexOf(myFingerprint) >= 0;
        var grow = Math.sqrt(n);

        // 멤버는 지우지 않고 재운다 — Map 에 남아야 퇴장·도망이 계속 대상을 찾는다
        for (var i = 0; i < n; i++) {
            var m = dosters.get(keys[i]);
            if (!m) continue;
            if (m.body && world) Matter.Composite.remove(world, m.body);
            m.body = null;
            m.blobId = id;
            if (m.postureTimer) { clearTimeout(m.postureTimer); m.postureTimer = null; }
            if (m.el) m.el.style.display = 'none';
        }

        var s = toLocal(DOSTER_PHYS_R[type] || DOSTER_PHYS_R[0]) * 1.7 * grow;
        var bh = s * 0.72;
        var body = Matter.Bodies.rectangle(cx, bottomY - bh / 2, s, bh, {
            chamfer: { radius: bh * 0.3 },
            restitution: 0.5,
            friction: PHYSICS.friction,
            frictionAir: PHYSICS.frictionAir,
            density: PHYSICS.density
        });
        Matter.Body.setInertia(body, body.inertia * 8);
        body.sleepThreshold = 30;
        body.halfH = bh / 2;
        body.blobId = id;
        Matter.Composite.add(world, body);

        var w = toLocal(DOSTER_SIZE[type] || DOSTER_SIZE[0]) * grow;
        var el = createBlobEl(id, type, w, hasMine);
        blobs.set(id, {
            id: id, body: body, el: el, inner: el.firstChild, type: type,
            memberKeys: keys.slice(), clicks: 0,
            remainMs: BLOB_LIFE_MS, lastTick: 0, idleTimer: null, dissolving: false
        });
        if (!animFrameId && isTabVisible && isActive) animFrameId = requestAnimationFrame(render);
    }
```

- [ ] **Step 4: Task 4의 자리표시 주석을 실제 호출로 바꾼다**

`tryMerge` 안의

```javascript
        if (!hit) return;
        // Task 5 에서 createBlob(keys, d.type, p.x, p.y + (d.body.halfH || 0)) 로 교체한다
```

를

```javascript
        if (!hit) return;
        createBlob(keys, d.type, p.x, p.y + (d.body.halfH || 0));
```

로 바꾼다.

- [ ] **Step 5: blob 위치를 매 프레임 동기화한다**

`syncDosterPositions` 함수 바로 뒤에 넣는다.

```javascript
    function syncBlobPositions() {
        blobs.forEach(function (b) {
            if (!b.body || !b.el) return;
            var pos = b.body.position;
            var halfSize = parseFloat(b.el.style.width) / 2;
            b.el.style.left = (pos.x - halfSize) + 'px';
            b.el.style.bottom = (STAGE_HEIGHT - pos.y - (b.body.halfH || halfSize)) + 'px';
            b.el.style.transform = 'rotate(' + (b.body.angle * 180 / Math.PI).toFixed(1) + 'deg)';
        });
    }
```

`render` 안의 `syncDosterPositions();` 다음 줄에 `syncBlobPositions();`를 추가한다.

- [ ] **Step 6: 기존 네 곳에 연동한다**

**(a) 충돌 — blob도 스쿼시를 받게.** `handleCollisions` 안 `squash` 두 줄 뒤에 추가한다. `squash`는 `d.inner`와 `d.fleeing`만 보므로 blob 객체에 그대로 쓸 수 있다.

```javascript
            if (p.bodyA.blobId) squash(blobs.get(p.bodyA.blobId), speed);
            if (p.bodyB.blobId) squash(blobs.get(p.bodyB.blobId), speed);
```

**(b) idle 루프 — 숨겨진 멤버를 후보에서 뺀다.** `startIdleLoop` 안의

```javascript
                if (d.landed && !d.fleeing && d.inner) candidates.push(d);
```

를

```javascript
                if (d.body && d.landed && !d.fleeing && d.inner) candidates.push(d);
```

로 바꾼다.

**(c) 잭팟 — blob도 같이 뛴다.** `triggerCharacterJump`의 `dosters.forEach(...)` 블록 뒤에 추가한다.

```javascript
        blobs.forEach(function (b) {
            if (!b.body || b.dissolving) return;
            Matter.Sleeping.set(b.body, false);
            Matter.Body.applyForce(b.body, b.body.position,
                { x: (Math.random() - 0.5) * 0.005, y: isBig ? -0.025 : -0.012 });
        });
```

**(d) 종료 정리.** `deactivate`의 `dosters.clear();` 앞에 추가한다.

```javascript
        blobs.forEach(function (b) {
            if (b.idleTimer) clearTimeout(b.idleTimer);
            if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
        });
        blobs.clear();
```

- [ ] **Step 7: CSS를 추가한다**

`assets/easter-egg.css`의 `.easter-stage .ee-mine` 줄 바로 뒤에 넣는다.

```css
/* 합체한 큰 도스터. 이미 자리 잡은 도스터들로 만들어지므로 landed 를 기다리지 않고 바로 눌린다. */
.easter-stage .ee-blob { transform-origin: center center; line-height: 0; pointer-events: auto; cursor: pointer; }
.easter-stage .ee-blob-body { width: 100%; height: auto; display: block; transform-origin: bottom center; }
```

- [ ] **Step 8: 큰 도스터가 실제로 만들어지는지 본다**

확률을 잠시 `MERGE_P5 = 1;`로 올려 결정적으로 만들고, 하네스 `?v=`를 갱신해 새로고침한 뒤:

```javascript
await ready(); clearAll();
for (var i = 0; i < 5; i++) { spawnAt(0.5); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
blobStat()
```

기대: `count: 1`, `items[0].w`가 **89 ± 3**, `outside: false`, `aboveStage: false`, `clickable: true`.

- [ ] **Step 9: 4마리 경로도 확인한다**

`MERGE_P4 = 1; MERGE_P5 = 0;`으로 바꾸고 4마리만 떨어뜨린다.

기대: `items[0].w`가 **80 ± 3**.

- [ ] **Step 10: 멤버가 화면에서 사라졌는지 확인한다**

```javascript
[blobStat().dosters,
 [].slice.call(document.querySelectorAll('.ee-doster'))
   .filter(function(e){ return e.style.display === 'none'; }).length]
```

기대: 두 값이 같다(모든 도스터 요소가 숨겨져 있고 blob만 보인다).

- [ ] **Step 11: 확률을 원래대로 되돌린다**

`MERGE_P5 = 0.12; MERGE_P4 = 0.05;`

---

### Task 6: 분해 — 함수 하나에 트리거 넷

**Files:**
- Modify: `assets/easter-egg.js` 합체 섹션 — `dissolve`, `finishDissolve` 추가
- Modify: `assets/easter-egg.js:445-447` (`triggerFleeAnimation`)
- Modify: `assets/easter-egg.js:649-651` (`removeCharacter`)

**Interfaces:**
- Consumes: `blobs`, `makeDosterBody`(Task 5), `BURST_FORCE`(Task 3)
- Produces: `dissolve(id)` — 같은 blob에 두 번 불려도 안전하다(`dissolving` 플래그)

- [ ] **Step 1: 분해 함수를 넣는다**

```javascript
    function dissolve(id) {
        var b = blobs.get(id);
        if (!b || b.dissolving) return;
        b.dissolving = true;
        if (b.idleTimer) { clearTimeout(b.idleTimer); b.idleTimer = null; }

        var pos = b.body ? { x: b.body.position.x, y: b.body.position.y } : null;
        // 숨을 들이켜듯 부풀었다 터진다
        var anim = b.inner.animate([
            { transform: 'scale(1,1)', opacity: 1 },
            { transform: 'scale(1.18,1.14)', offset: 0.6, opacity: 1 },
            { transform: 'scale(1.4,1.4)', opacity: 0 }
        ], { duration: 200, easing: 'ease-in' });
        anim.onfinish = function () { finishDissolve(id, pos); };
    }

    function finishDissolve(id, pos) {
        var b = blobs.get(id);
        if (!b) return;
        if (b.body && world) Matter.Composite.remove(world, b.body);
        if (b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
        blobs.delete(id);
        if (!pos) return;

        // 그사이 나간 사람은 이미 dosters 에서 지워졌으므로 자동으로 빠진다
        var live = b.memberKeys.filter(function (k) {
            var m = dosters.get(k);
            return m && m.blobId === id;
        });
        for (var i = 0; i < live.length; i++) {
            var m = dosters.get(live[i]);
            var ang = (i / live.length) * Math.PI * 2 + Math.random() * 0.5;
            m.blobId = null;
            if (m.el) { m.el.style.display = ''; m.el.classList.remove('landed'); }
            m.body = makeDosterBody(pos.x + Math.cos(ang) * toLocal(13),
                                    pos.y + Math.sin(ang) * toLocal(9), m.type);
            m.body.dosterKey = live[i];
            Matter.Body.applyForce(m.body, m.body.position,
                { x: Math.cos(ang) * BURST_FORCE, y: (Math.sin(ang) - 0.7) * BURST_FORCE });
            m.landed = false;
            m.wasSleeping = false;
        }
        if (!animFrameId && isTabVisible && isActive) animFrameId = requestAnimationFrame(render);
    }
```

- [ ] **Step 2: 도망 트리거를 연결한다 — 여기가 유일한 구멍이었다**

`triggerFleeAnimation` 첫머리를

```javascript
    function triggerFleeAnimation(key, dir) {
        var d = dosters.get(key);
        if (!d || !d.el || d.fleeing) return;
```

이렇게 바꾼다.

```javascript
    function triggerFleeAnimation(key, dir) {
        var d = dosters.get(key);
        if (!d || !d.el || d.fleeing) return;
        // blob 에 흡수된 도스터다. 먼저 터뜨려 꺼낸 뒤 도망시킨다 —
        // 그냥 두면 숨겨진 요소가 화면 밖으로 달려가고 blob 은 그대로 남는다.
        if (d.blobId) {
            dissolve(d.blobId);
            setTimeout(function () { triggerFleeAnimation(key, dir); }, 260);
            return;
        }
```

- [ ] **Step 3: 퇴장 트리거를 연결한다**

`removeCharacter`의

```javascript
        var d = dosters.get(key);
        if (d) {
            if (d.body && world) Matter.Composite.remove(world, d.body);
```

를

```javascript
        var d = dosters.get(key);
        if (d) {
            if (d.blobId) dissolve(d.blobId);
            if (d.body && world) Matter.Composite.remove(world, d.body);
```

로 바꾼다.

- [ ] **Step 4: 퇴장으로 터지는지, 나간 사람만 빠지는지 확인한다**

`MERGE_P5 = 1;`로 두고:

```javascript
await ready(); clearAll();
var ks = [];
for (var i = 0; i < 5; i++) { ks.push(spawnAt(0.5)); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
var before = blobStat().count;
removeKey(ks[0]);
await new Promise(function(r){ setTimeout(r, 3000); });
[before, blobStat().count, document.querySelectorAll('.ee-doster').length]
```

기대: `[1, 0, 4]` — blob이 터지고, 나간 하나를 뺀 넷이 돌아왔다.

- [ ] **Step 5: 복원된 도스터가 다시 클릭 가능해지는지 확인한다**

이어서:

```javascript
await new Promise(function(r){ setTimeout(r, 5000); });
var all = [].slice.call(document.querySelectorAll('.ee-doster'));
[all.length, all.filter(function(e){ return e.classList.contains('landed'); }).length]
```

기대: 두 값이 같다. 하나라도 `landed`가 안 붙으면 예전의 "눌러도 안 되는 도스터" 버그가 재발한 것이다.

- [ ] **Step 6: 도망 트리거를 확인한다**

```javascript
await ready(); clearAll();
var ks = [];
for (var i = 0; i < 5; i++) { ks.push(spawnAt(0.5)); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
fleeKey(ks[2], 'left');
await new Promise(function(r){ setTimeout(r, 4000); });
[blobStat().count, document.querySelectorAll('.ee-doster').length]
```

기대: `[0, 4]` — blob이 터지고 도망친 하나가 화면 밖으로 사라졌다.

- [ ] **Step 7: 터진 조각이 밖으로 안 나가는지 확인한다**

Step 4를 5회 반복하며 매번 잰다.

```javascript
var foot = document.querySelector('footer').getBoundingClientRect();
[].slice.call(document.querySelectorAll('.ee-doster')).filter(function(e){
  var r = e.getBoundingClientRect();
  return r.left < foot.left - 1 || r.right > foot.right + 1 || foot.top - r.bottom > 125;
}).length
```

기대: 매번 `0`. 0이 아니면 `BURST_FORCE`를 낮춘다(0.018 → 0.012).

- [ ] **Step 8: 확률을 원래대로 되돌린다**

---

### Task 7: 수명 — 보고 있을 때만 흐른다

설계에서 가장 중요한 부분이다. 이게 없으면 합체는 아무도 안 보는 사이에 일어나고 혼자 터진다.

**Files:**
- Modify: `assets/easter-egg.js` 합체 섹션 — `stageInView`, `watchStageVisibility`, `tickBlobLife` 추가
- Modify: `assets/easter-egg.js:535` 근처 (`render`), `:1260`(`init`), `:927`(`activate`), `:952`(`deactivate`)

**Interfaces:**
- Consumes: `blobs`, `dissolve`(Task 6), `BLOB_LIFE_MS`(Task 3)
- Produces: `stageInView` 플래그, `tickBlobLife(now)`

- [ ] **Step 1: 뷰포트 감시를 넣는다**

```javascript
    // 수명은 "탭이 보이고 && 스테이지가 화면 안"일 때만 흐른다.
    // 합체는 진입 직후 푸터에서 일어나는데 그때 사용자는 계산기 상단을 보고 있다 —
    // 그냥 두면 아무도 안 보는 사이에 뭉쳤다 혼자 터진다.
    var stageInView = true;
    var stageObserver = null;

    function watchStageVisibility() {
        if (!stage || typeof IntersectionObserver === 'undefined') { stageInView = true; return; }
        stageObserver = new IntersectionObserver(function (entries) {
            stageInView = entries[0].isIntersecting;
        }, { threshold: 0.3 });
        stageObserver.observe(stage);
    }
```

- [ ] **Step 2: 수명 진행 함수를 넣는다**

```javascript
    function tickBlobLife(now) {
        if (blobs.size === 0) return;
        if (!(isTabVisible && stageInView && isActive)) {
            blobs.forEach(function (b) { b.lastTick = 0; });
            return;
        }
        blobs.forEach(function (b) {
            if (b.dissolving) return;
            if (!b.lastTick) { b.lastTick = now; return; }
            b.remainMs -= (now - b.lastTick);
            b.lastTick = now;
            if (b.remainMs <= 0) dissolve(b.id);
        });
    }
```

- [ ] **Step 3: 렌더 루프에 건다**

`render` 안 `syncBlobPositions();` 다음 줄에 추가한다.

```javascript
        tickBlobLife(t);
```

- [ ] **Step 4: 시작·종료에 연결한다**

`init`과 `activate` 양쪽에서 `animFrameId = requestAnimationFrame(render);` 바로 앞에 넣는다.

```javascript
        watchStageVisibility();
```

`deactivate`의 blob 정리 블록 뒤에 넣는다.

```javascript
        if (stageObserver) { stageObserver.disconnect(); stageObserver = null; }
```

- [ ] **Step 5: 화면 밖에서는 수명이 안 줄어드는지 확인한다**

하네스 본문에 스크롤이 생길 만큼 여백이 없으면 `document.body.style.paddingTop = '2000px'`로 만든 뒤 측정한다. `MERGE_P5 = 1;`로 둔다.

```javascript
await ready(); clearAll();
document.body.style.paddingTop = '2000px';
document.getElementById('easter-egg-stage').scrollIntoView();
for (var i = 0; i < 5; i++) { spawnAt(0.5); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
window.scrollTo(0, 0);
await new Promise(function(r){ setTimeout(r, 20000); });
blobStat().count
```

기대: `1`. 20초를 기다렸는데도 살아 있어야 한다.

- [ ] **Step 6: 화면 안으로 되돌리면 15초 뒤 터지는지 확인한다**

이어서:

```javascript
document.getElementById('easter-egg-stage').scrollIntoView();
await new Promise(function(r){ setTimeout(r, 8000); });
var mid = blobStat().count;
await new Promise(function(r){ setTimeout(r, 9000); });
[mid, blobStat().count]
```

기대: `[1, 0]` — 8초 시점엔 살아 있고 17초 시점엔 터져 있다.

- [ ] **Step 7: blob이 하나뿐인지 확인한다**

```javascript
await ready(); clearAll();
for (var i = 0; i < 12; i++) { spawnAt(0.45 + (i % 3) * 0.03); await new Promise(function(r){ setTimeout(r, 700); }); }
await new Promise(function(r){ setTimeout(r, 2000); });
blobStat().count
```

기대: `1` 이하. 2 이상이면 `blobs.size > 0` 가드가 안 걸린 것이다.

- [ ] **Step 8: 확률을 원래대로 되돌린다**

---

### Task 8: 클릭 세 번에 터진다

**Files:**
- Modify: `assets/easter-egg.js` 합체 섹션 — `handleBlobClick` 추가

**Interfaces:**
- Consumes: `blobs`, `dissolve`(Task 6)
- Produces: `handleBlobClick(id)` — Task 5의 `createBlobEl`이 이미 부르고 있다

- [ ] **Step 1: 클릭 핸들러를 넣는다**

```javascript
    // 쿨다운 없음 — blob 은 Firebase 를 거치지 않으므로 도망의 3초 제한이 필요 없다.
    // 안쪽 img 만 흔들어 아래 깔린 도스터 더미를 건드리지 않는다.
    function handleBlobClick(id) {
        var b = blobs.get(id);
        if (!b || b.dissolving || !b.inner) return;
        b.clicks++;
        if (b.clicks >= 3) { dissolve(id); return; }
        var deg = b.clicks === 1 ? 5 : 11;
        var sq = b.clicks === 1 ? 0.04 : 0.09;
        b.inner.animate([
            { transform: 'rotate(0deg) scale(1,1)' },
            { transform: 'rotate(' + deg + 'deg) scale(' + (1 + sq) + ',' + (1 - sq) + ')', offset: 0.25 },
            { transform: 'rotate(' + (-deg) + 'deg) scale(' + (1 - sq) + ',' + (1 + sq) + ')', offset: 0.6 },
            { transform: 'rotate(0deg) scale(1,1)' }
        ], { duration: b.clicks === 1 ? 280 : 420, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    }
```

- [ ] **Step 2: 세 번에 터지는지 확인한다**

`MERGE_P5 = 1;`로 두고:

```javascript
await ready(); clearAll();
for (var i = 0; i < 5; i++) { spawnAt(0.5); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
var el = document.querySelector('.ee-blob');
var seen = [];
for (var c = 0; c < 3; c++) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 500); });
  seen.push(blobStat().count);
}
await new Promise(function(r){ setTimeout(r, 600); });
[seen, blobStat().count]
```

기대: `[[1,1,0], 0]` — 두 번째까지는 살아 있고 세 번째에 터진다.

- [ ] **Step 3: 연타해도 안전한지 확인한다**

```javascript
await ready(); clearAll();
for (var i = 0; i < 5; i++) { spawnAt(0.5); await new Promise(function(r){ setTimeout(r, 900); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
var el = document.querySelector('.ee-blob');
for (var c = 0; c < 10; c++) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
await new Promise(function(r){ setTimeout(r, 2000); });
[blobStat().count, document.querySelectorAll('.ee-doster').length]
```

기대: `[0, 5]` — 열 번을 연타해도 한 번만 분해되고 다섯이 온전히 돌아온다.

- [ ] **Step 4: 확률을 원래대로 되돌린다**

---

### Task 9: 연출 넷 — 흡입·반짝·blob idle·실패

기능은 이미 다 돌아간다. 여기서는 보이는 것만 손본다.

**Files:**
- Modify: `assets/easter-egg.js` — `createBlob`에 흡입 단계 삽입, `scheduleBlobIdle`·`nearMiss` 추가
- Modify: `assets/easter-egg.css` — 금색 반짝·blob idle 키프레임

**Interfaces:**
- Consumes: `createBlob`(Task 5), `tryMerge`(Task 4), `NEARMISS_GAP_MS`(Task 3)
- Produces: `scheduleBlobIdle(b)`, `nearMiss(keys)`

- [ ] **Step 1: 합체를 두 단계로 나눈다 — 빨려든 뒤에 뭉친다**

`createBlob`의 멤버 재우기 루프에서 `m.el.style.display = 'none';`을 지우고, 바디만 제거한 뒤 요소를 중심으로 빨아들인다. 루프를 이렇게 바꾼다.

```javascript
        var suck = [];
        for (var i = 0; i < n; i++) {
            var m = dosters.get(keys[i]);
            if (!m) continue;
            if (m.body && world) Matter.Composite.remove(world, m.body);
            m.body = null;                  // 바디를 먼저 빼야 위치 동기화가 연출과 싸우지 않는다
            m.blobId = id;
            if (m.postureTimer) { clearTimeout(m.postureTimer); m.postureTimer = null; }
            if (m.el) suck.push(m.el);
        }
        for (var j = 0; j < suck.length; j++) {
            var e = suck[j];
            var dx = cx - (parseFloat(e.style.left) + parseFloat(e.style.width || 0) / 2);
            var dy = (STAGE_HEIGHT - bottomY) - parseFloat(e.style.bottom);
            e.animate([
                { transform: e.style.transform || 'none' },
                { transform: 'translate(' + dx.toFixed(1) + 'px,' + (-dy).toFixed(1) + 'px) scale(0.45)',
                  opacity: 0.65 }
            ], { duration: 300, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
        }
```

그리고 blob 생성 부분(바디·요소를 만들고 `blobs.set`까지)을 `setTimeout(function () { ... }, 300);` 안으로 옮겨 빨려든 뒤에 나타나게 한다. 그 콜백 맨 앞에서 멤버를 숨긴다.

```javascript
        setTimeout(function () {
            suck.forEach(function (e) {
                e.getAnimations().forEach(function (a) { a.cancel(); });
                e.style.display = 'none';
            });
            // ── 여기부터 기존 blob 바디·요소 생성 코드 ──
```

`blobs.set` 뒤에 나타나는 연출을 붙인다.

```javascript
            el.animate([
                { transform: 'scale(0.55,0.55)', opacity: 0.7 },
                { transform: 'scale(1.12,1.08)', offset: 0.55, opacity: 1 },
                { transform: 'scale(1,1)', opacity: 1 }
            ], { duration: 320, easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)' });
        }, 300);
```

- [ ] **Step 2: 내 도스터가 섞였으면 금색으로 한 번 반짝인다**

위 애니메이션 옆에 추가한다.

```javascript
            if (hasMine) {
                el.classList.add('mine-flash');
                el.addEventListener('animationend', function h() {
                    el.classList.remove('mine-flash');
                    el.removeEventListener('animationend', h);
                });
            }
```

CSS에 추가한다.

```css
/* ee-mine 의 은은한 그림자만으로는 "내 것이 저기 섞였다"가 안 읽힌다 */
@keyframes blobMineFlash {
    0% { filter: drop-shadow(0 0 4px rgba(255,255,255,0.5)); }
    22% { filter: drop-shadow(0 0 20px rgba(255,215,0,0.95)) brightness(1.4); }
    100% { filter: drop-shadow(0 0 4px rgba(255,255,255,0.5)); }
}
.easter-stage .ee-blob.mine-flash { animation: blobMineFlash 1.1s ease-out; }
```

- [ ] **Step 3: blob 전용 idle을 넣는다**

전역 idle 루프는 10~15초 간격인데 수명이 15초라 볼 기회가 없다. 자체 타이머로 돌린다.

```javascript
    // 5배 큰 놈이 기존 idle(0.5~0.8초짜리 잔망스러운 갸우뚱)을 쓰면 가벼워 보인다
    function scheduleBlobIdle(b) {
        b.idleTimer = setTimeout(function () {
            b.idleTimer = null;
            if (b.dissolving || !b.inner || !blobs.has(b.id)) return;
            b.inner.classList.add('blob-idle');
            b.inner.addEventListener('animationend', function h() {
                b.inner.classList.remove('blob-idle');
                b.inner.removeEventListener('animationend', h);
            });
            scheduleBlobIdle(b);
        }, 3500 + Math.random() * 2000);
    }
```

`blobs.set` 뒤에서 `scheduleBlobIdle(blobs.get(id));`를 부른다. CSS에 추가한다.

```css
@keyframes blobIdle {
    0%, 100% { transform: scale(1,1); }
    35% { transform: scale(1.05,0.94); }
    70% { transform: scale(0.98,1.03); }
}
.easter-stage .ee-blob-body.blob-idle { animation: blobIdle 1.6s ease-in-out; }
```

- [ ] **Step 4: 합체 실패 연출을 넣는다**

```javascript
    // 자격이 됐는데 확률을 놓치면 서로를 향해 잠깐 기운다 —
    // 88% 가 아무 일 없이 지나가면 어쩌다 합쳐질 때 규칙을 알 수가 없다.
    function nearMiss(keys) {
        var now = performance.now();
        if (now - lastNearMiss < NEARMISS_GAP_MS) return;
        lastNearMiss = now;
        var cx = 0, n = 0;
        keys.forEach(function (k) {
            var m = dosters.get(k);
            if (m && m.body) { cx += m.body.position.x; n++; }
        });
        if (!n) return;
        cx /= n;
        keys.forEach(function (k) {
            var m = dosters.get(k);
            if (!m || !m.body || !m.inner) return;
            var dir = m.body.position.x < cx ? 1 : -1;
            m.inner.animate([
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(' + (dir * 9) + 'deg)', offset: 0.45 },
                { transform: 'rotate(0deg)' }
            ], { duration: 460, easing: 'ease-in-out' });
        });
    }
```

`tryMerge`의 `if (!hit) return;`을 `if (!hit) { nearMiss(keys); return; }`으로 바꾼다.

- [ ] **Step 5: 실패 연출이 3초에 한 번을 넘지 않는지 확인한다**

`nearMiss` 첫 줄 바로 뒤에 임시 계측을 넣는다.

```javascript
        if (window.__nmLog) window.__nmLog.push(now);
```

그리고:

```javascript
window.__nmLog = [];
await ready(); clearAll();
for (var i = 0; i < 14; i++) { spawnAt(0.48 + (i % 4) * 0.02); await new Promise(function(r){ setTimeout(r, 650); }); }
await new Promise(function(r){ setTimeout(r, 3000); });
var g = [];
for (var i = 1; i < window.__nmLog.length; i++) g.push(Math.round(window.__nmLog[i] - window.__nmLog[i-1]));
[window.__nmLog.length, g, g.filter(function(x){ return x < 3000; }).length]
```

기대: 마지막 값이 `0` — 3초보다 짧은 간격이 하나도 없다. 확인 뒤 임시 계측 줄을 지운다.

- [ ] **Step 6: 합체·분해 연출을 눈으로 확인한다**

`MERGE_P5 = 1;`로 두고 blob을 만든 뒤 `computer { action: "screenshot" }`을 흡입 중(약 0.15초)·완성 후·클릭 후·분해 중에 찍는다.

기대: 빨려드는 도중에 도스터들이 중심으로 모여 작아져 있고, 완성 후엔 큰 도스터 하나만 보인다. 내 도스터가 섞였다면 금색 테두리가 한 번 보인다.

- [ ] **Step 7: 확률을 원래대로 되돌린다**

---

### Task 10: 회귀 측정 · 정리 · 인계

**Files:**
- Modify: `index.html` (캐시 버스터 두 곳)
- Move: `<프로젝트>/_eastertest.html` → `<스크래치패드>/_eastertest.html`

- [ ] **Step 1: 문법을 확인한다**

```bash
node --check assets/easter-egg.js
```

기대: 출력 없음.

- [ ] **Step 2: 기존 물리 회귀를 잰다**

확률을 실제 값(0.12 / 0.05)으로 되돌린 상태여야 한다.

```javascript
await ready(); clearAll();
for (var i = 0; i < 14; i++) spawn(1);
await new Promise(function(r){ setTimeout(r, 5000); });
var all = [].slice.call(document.querySelectorAll('.ee-doster'))
             .filter(function(e){ return e.style.display !== 'none'; });
var foot = document.querySelector('footer').getBoundingClientRect();
var rots = all.map(function(e){
  var m = /rotate\(([-\d.]+)deg\)/.exec(e.style.transform || '');
  var d = m ? Math.abs(parseFloat(m[1])) % 360 : 0;
  return d > 180 ? 360 - d : d;
}).sort(function(a,b){ return a - b; });
({
  착지: all.filter(function(e){ return e.classList.contains('landed'); }).length + '/' + all.length,
  회전중위: Math.round(rots[Math.floor(rots.length/2)]),
  '45도초과': rots.filter(function(d){ return d > 45; }).length,
  푸터밖: all.filter(function(e){
    var r = e.getBoundingClientRect();
    return r.left < foot.left - 1 || r.right > foot.right + 1;
  }).length
})
```

기대: 착지 **전부**, 회전 중위 **10도 이하**, 45도 초과 **0**, 푸터밖 **0**. 기존 측정치와 같은 수준이어야 한다.

- [ ] **Step 3: 도구 페이지에서도 도는지 확인한다**

이스터에그 CSS·JS는 `index.html`과 도구 페이지가 공유하고, `body.content-page`에서 스테이지 폭이 94%로 달라진다. `/tikatuka`로 이동해 도스터가 뜨고 푸터 안에 머무는지 스크린샷으로 확인한다.

- [ ] **Step 4: 하네스를 프로젝트에서 치운다**

```bash
mv "<프로젝트>/_eastertest.html" "<스크래치패드>/_eastertest.html"
```

`ls`로 프로젝트 루트에 남아 있지 않은지 확인한다. **배포 폴더에 절대 들어가면 안 된다.**

- [ ] **Step 5: 캐시 버스터를 갱신한다**

`index.html`의 두 줄에서 `?v=` 값을 오늘 날짜로 바꾼다.

```
assets/easter-egg.js?v=20260826
assets/easter-egg.css?v=20260826
```

확인:

```bash
grep -n "easter-egg\.\(js\|css\)?v=" index.html
```

- [ ] **Step 6: 변경 요약을 사용자에게 넘긴다**

**커밋하지 않는다.** 변경 파일 목록과 Step 2의 측정 결과를 정리해 보고하고, 운영 폴더 동기화 허가를 받는다.

바뀐 파일:
- `assets/easter-egg.js`
- `assets/easter-egg.css`
- `index.html` (캐시 버스터만)
- `docs/superpowers/specs/2026-08-26-doster-merge-design.md` (신규)
- `docs/superpowers/plans/2026-08-26-doster-merge.md` (신규)

커밋 메시지 초안(사용자가 그대로 쓸 수 있게):

```
feat(easter-egg): 도스터가 모이면 뭉쳤다 터지는 연출 추가

합체
- 착지 순간 반경 60px 안의 도스터를 세어, 5마리 이상 12% / 4마리 5% 로 합체
- 합쳐진 멤버는 지우지 않고 재워 퇴장·도망 처리가 계속 동작
- blob 은 한 번에 하나, 최대 5마리

수명
- 탭이 보이고 스테이지가 화면 안일 때만 흐름
  (합체는 진입 직후 푸터에서 일어나 그냥 두면 아무도 못 본다)
- 클릭 세 번, 멤버 퇴장, 멤버 도망으로도 분해

기존 코드
- 커서 밀기에서 질량 곱 제거 — 가속도가 질량과 무관해져 있던 문제
- 도망 처리가 blob 멤버를 확인하지 않던 구멍 보완
- 벽 여백을 합체 최대 크기 기준으로
```

---

## 자체 점검

**스펙 대응** — 2절 상태 모델 → T5. 3절 판정 → T4. 4절 연출·수명·idle → T7·T8·T9. 5절 분해 4트리거 → T6. 6절 변경점 9개 → 6-1(T4) 6-2(T6) 6-3(T6) 6-4(T2) 6-5(T3) 6-6(T7) 6-7(T5) 6-8(T5) 6-9(T5). 7절 부수개선 4건 → 7-1(T2) 7-2(T9) 7-3(T9) 7-4(T9). 9절 검증표 10항목 → T3·T4·T5·T6·T7·T8·T10에 분산. 누락 없음.

**이름 일관성** — `makeDosterBody`(T5 정의, T6 사용), `dissolve`/`finishDissolve`(T6 정의, T7·T8 사용), `handleBlobClick`(T5에서 참조, T8 정의 — 그사이 blob을 클릭하면 아무 일도 안 일어나는 것이 정상), `scheduleBlobIdle`/`nearMiss`(T9), `tickBlobLife`/`stageInView`(T7), `blobStat`/`removeKey`/`fleeKey`(T1). 충돌 없음.

**태스크 순서 의존** — T3(상수)는 T4보다 먼저. T5는 T4의 자리표시를 대체. T6은 T5의 `makeDosterBody`에 의존. T7·T8은 T6의 `dissolve`에 의존. T9는 T5의 `createBlob`을 개조. 순서대로만 실행 가능하다.

**확률 상수 되돌리기** — T5·T6·T7·T8·T9에서 측정을 위해 `MERGE_P5`/`MERGE_P4`를 1로 올린다. 각 태스크 마지막 스텝에 되돌리는 단계를 두었고, T10 Step 2가 실제 값으로 다시 확인한다.

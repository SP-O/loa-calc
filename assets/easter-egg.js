// 이스터에그: 실시간 모코코/도스터 시스템 (독립 IIFE)
// Vue 앱과 커플링 없음 — window.LoaDossEasterEgg API로만 통신
// 필요한 것: #easter-egg-stage, firebase-app/database, matter.js
// 모바일 · loa_easter=off · 스테이지 부재면 스스로 조용히 빠진다
(function() {
    'use strict';

    // ═══════════════════════════════════════════
    //  CONFIGURATION
    // ═══════════════════════════════════════════

    var STAGE_HEIGHT = 120;
    var MAX_USERS = 100;
    var MOBILE_BREAKPOINT = 925;

    // 크기는 화면 픽셀 기준 고정값. 메인의 .container 는 창 폭에 따라 zoom(1.1~0.85)이 달라지므로
    // 그 배율을 stageScale 로 상쇄해, 어느 페이지·어느 창 폭에서도 같은 크기로 보이게 한다.
    var MOKOKO_WIDTH = 35;
    var MOKOKO_MIN_GAP = 6;
    var DOSTER_SIZE = [40, 40];
    var DOSTER_PHYS_R = [20, 20]; // 물리 충돌 반지름

    // 도스터 중력 절반
    var PHYSICS = {
        gravity: { x: 0, y: 0.3 },
        friction: 0.5,
        frictionAir: 0.034,
        density: 0.002
    };

    // ═══════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════
    var myFingerprint = null;
    var db = null;
    var usersRef = null;
    var myUserRef = null;
    var isConnected = false;
    var isSpectator = false;
    var isActive = true;
    var firebaseInitialized = false;

    var mokokos = new Map();   // key -> { normalizedX, pixelX, el }
    var dosters = new Map();   // key -> { body, type, el, landed }

    var engine = null;
    var world = null;
    var ground = null;
    var wallLeft = null;
    var wallRight = null;

    var stage = null;
    var animFrameId = null;
    var isTabVisible = true;

    var pendingAdds = [];
    var pendingRemoves = [];
    var hasPendingUpdates = false;
    var firebaseQuery = null;
    var lastWriteTime = 0;

    // ═══════════════════════════════════════════
    //  DEVICE FINGERPRINT
    // ═══════════════════════════════════════════
    function getDeviceFingerprint() {
        var components = [
            screen.width, screen.height, screen.colorDepth,
            navigator.hardwareConcurrency || 'x',
            navigator.language, navigator.platform,
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            getCanvasFingerprint()
        ];
        var str = components.join('|');
        var hash = 5381;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return 'fp_' + Math.abs(hash).toString(36);
    }

    function getCanvasFingerprint() {
        try {
            var c = document.createElement('canvas');
            c.width = 200; c.height = 50;
            var x = c.getContext('2d');
            x.textBaseline = 'top';
            x.font = '14px Arial';
            x.fillStyle = '#f60';
            x.fillRect(50, 0, 80, 30);
            x.fillStyle = '#069';
            x.fillText('LoaDoss!', 2, 15);
            return c.toDataURL().slice(-32);
        } catch(e) { return 'nc'; }
    }

    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    // ═══════════════════════════════════════════
    //  MATTER.JS PHYSICS (도스터 낙하 전용)
    // ═══════════════════════════════════════════
    function initPhysics() {
        engine = Matter.Engine.create({ enableSleeping: true, gravity: PHYSICS.gravity });
        world = engine.world;
        Matter.Events.on(engine, 'collisionStart', handleCollisions);
        updatePhysicsBounds();
    }

    // 부딪힌 세기에 비례해 눌렸다 펴진다. 세게 떨어지면 납작, 살살 앉으면 거의 그대로.
    function handleCollisions(e) {
        for (var i = 0; i < e.pairs.length; i++) {
            var p = e.pairs[i];
            var dx = (p.bodyA.velocity.x || 0) - (p.bodyB.velocity.x || 0);
            var dy = (p.bodyA.velocity.y || 0) - (p.bodyB.velocity.y || 0);
            var speed = Math.sqrt(dx * dx + dy * dy);
            if (p.bodyA.dosterKey) squash(dosters.get(p.bodyA.dosterKey), speed);
            if (p.bodyB.dosterKey) squash(dosters.get(p.bodyB.dosterKey), speed);
        }
    }

    function squash(d, speed) {
        if (!d || !d.inner || d.fleeing) return;
        var k = Math.min(speed / 12, 1);
        if (k < 0.12) return;                       // 스치는 정도는 무시
        var now = performance.now();
        if (now - (d.lastSquash || 0) < 120) return; // 연속 충돌로 떨리는 것 방지
        d.lastSquash = now;

        var sy = 1 - 0.28 * k, sx = 1 / sy;          // 눌린 만큼 옆으로 퍼진다
        // fill 을 주지 않아 끝나면 스스로 원상복귀 — 인라인 transform 을 붙들지 않는다
        d.inner.animate([
            { transform: 'scale(1,1)' },
            { transform: 'scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')', offset: 0.18 },
            { transform: 'scale(' + (2 - sx).toFixed(3) + ',' + (2 - sy).toFixed(3) + ')', offset: 0.55 },
            { transform: 'scale(1,1)' }
        ], { duration: 260 + 140 * k, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    }

    // 부모에 zoom 이 걸려 있으면 스테이지 안의 1px 이 화면 1px 이 아니다.
    // 화면 픽셀 기준 크기를 스테이지 로컬 px 로 바꿔 쓰기 위한 배율.
    var stageScale = 1;
    function updateStageScale() {
        if (!stage || !stage.offsetWidth) { stageScale = 1; return; }
        var s = stage.getBoundingClientRect().width / stage.offsetWidth;
        stageScale = (s > 0.2 && s < 5) ? s : 1;
    }
    function toLocal(px) { return px / stageScale; }
    function mokokoW() { return toLocal(MOKOKO_WIDTH); }
    function dosterW(type) { return toLocal(DOSTER_SIZE[type] || DOSTER_SIZE[0]); }

    // 캐릭터가 노는 범위 = 스테이지 폭. 스테이지는 푸터와 같은 박스라 푸터 밖으로 나가지 않는다.
    function getExtendedBounds() {
        var stageW = stage ? stage.offsetWidth : window.innerWidth;
        return { stageW: stageW, left: 0, right: stageW };
    }

    // 도망친 도스터가 화면 밖으로 사라졌는지 볼 때만 쓰는 화면 끝 좌표(스테이지 로컬 px)
    function getScreenBounds() {
        if (!stage) return { left: 0, right: window.innerWidth };
        var rect = stage.getBoundingClientRect();
        return { left: toLocal(-rect.left), right: toLocal(window.innerWidth - rect.left) };
    }

    // 창 폭이 바뀌면 zoom 단계가 달라지므로 이미 그려진 캐릭터 크기도 다시 맞춘다
    function restyleCharacters() {
        var mw = mokokoW();
        mokokos.forEach(function(m) { if (m.el) m.el.style.width = mw + 'px'; });
        dosters.forEach(function(d) { if (d.el) d.el.style.width = dosterW(d.type) + 'px'; });
    }

    function updatePhysicsBounds() {
        if (!world) return;
        updateStageScale();
        var b = getExtendedBounds();
        if (ground) Matter.Composite.remove(world, ground);
        if (wallLeft) Matter.Composite.remove(world, wallLeft);
        if (wallRight) Matter.Composite.remove(world, wallRight);

        var totalW = b.right - b.left;
        var centerX = (b.left + b.right) / 2;
        ground = Matter.Bodies.rectangle(centerX, STAGE_HEIGHT + 5, totalW + 100, 10, { isStatic: true });
        // 접속자가 많으면 도스터가 여러 층으로 쌓이므로 벽을 위로 넉넉히 세운다
        var wallH = 2000;
        // 그려지는 스프라이트는 물리 바디보다 넓고, 기울면 더 넓어진다.
        // 그만큼 벽을 안쪽으로 들여야 푸터 선 밖으로 삐져나오지 않는다.
        var half = dosterW(0) / 2;
        var bodyHalf = toLocal(DOSTER_PHYS_R[0]) * 1.7 / 2;   // 바디 반너비
        var inset = (half - bodyHalf) + half * (Math.SQRT2 - 1);
        wallLeft = Matter.Bodies.rectangle(b.left + inset - 5, STAGE_HEIGHT - wallH / 2, 10, wallH, { isStatic: true });
        wallRight = Matter.Bodies.rectangle(b.right - inset + 5, STAGE_HEIGHT - wallH / 2, 10, wallH, { isStatic: true });
        Matter.Composite.add(world, [ground, wallLeft, wallRight]);
    }

    function createDosterBody(normalizedX, type) {
        var w = stage ? stage.offsetWidth : window.innerWidth;
        var x = normalizedX * w;
        // 원은 굴러 미끄러져 층이 안 쌓이고, 정사각형은 옆으로 누운 자세도 똑같이 안정적이라
        // 스스로 일어나지 못한다. 가로로 납작한 형태라야 바로 선 자세가 유일하게 안정적이다.
        var s = toLocal(DOSTER_PHYS_R[type] || DOSTER_PHYS_R[0]) * 1.7;
        var bh = s * 0.72;
        // 개체차 — 잘 튀는 애와 묵직한 애가 섞여야 지켜보는 재미가 산다
        var body = Matter.Bodies.rectangle(x, -40, s, bh, {
            chamfer: { radius: bh * 0.3 },
            restitution: 0.35 + Math.random() * 0.25,
            friction: PHYSICS.friction,
            frictionAir: PHYSICS.frictionAir,
            density: PHYSICS.density * (0.85 + Math.random() * 0.3)
        });
        // 사각형은 접촉점이 많아 기본 문턱(60프레임)으로는 잠들기까지 한참 걸린다.
        // 늦게 잠들면 landed 가 늦게 붙어 그동안 클릭이 되지 않는다.
        body.sleepThreshold = 30;
        body.halfH = bh / 2;   // 스프라이트 하단을 바닥에 맞추는 데 쓴다
        Matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: 0 });
        Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.08);
        Matter.Composite.add(world, body);
        return body;
    }

    function removeDosterBody(key) {
        var d = dosters.get(key);
        if (d && d.body && world) Matter.Composite.remove(world, d.body);
    }

    function hasAwakeBodies() {
        if (!world) return false;
        var bodies = Matter.Composite.allBodies(world);
        for (var i = 0; i < bodies.length; i++) {
            if (!bodies[i].isSleeping && !bodies[i].isStatic) return true;
        }
        return false;
    }

    // ═══════════════════════════════════════════
    //  MOKOKO PLACEMENT (1D 패킹)
    // ═══════════════════════════════════════════
    function recalculateMokokoPositions() {
        if (mokokos.size === 0) return;
        var stageW = stage ? stage.offsetWidth : window.innerWidth;
        var b = getExtendedBounds();
        var totalW = b.right - b.left;  // 화면 전체 너비 (스테이지 로컬 좌표 기준)
        var slotW = mokokoW() + toLocal(MOKOKO_MIN_GAP);
        var entries = [];

        mokokos.forEach(function(m, key) { entries.push({ key: key, nx: m.normalizedX }); });
        entries.sort(function(a, b) { return a.nx - b.nx; });

        // 스테이지 너비 기준으로 먼저 배치 시도
        var minGap = slotW / stageW;
        for (var i = 1; i < entries.length; i++) {
            if (entries[i].nx - entries[i - 1].nx < minGap)
                entries[i].nx = entries[i - 1].nx + minGap;
        }

        // 스테이지 안에 다 들어가면 기존 로직 유지
        var last = entries[entries.length - 1];
        var maxNStage = 1 - (mokokoW() / 2) / stageW;
        var fitsInStage = last.nx <= maxNStage;

        if (fitsInStage) {
            // 스테이지 내부에서 clamp
            var minN = (mokokoW() / 2) / stageW;
            for (var k = 0; k < entries.length; k++) {
                if (entries[k].nx < minN) entries[k].nx = minN;
            }
            entries.forEach(function(e) {
                var m = mokokos.get(e.key);
                if (m) {
                    m.pixelX = e.nx * stageW;
                    if (m.el) m.el.style.left = (m.pixelX - mokokoW() / 2) + 'px';
                }
            });
        } else {
            // 다 안 들어가면 스테이지 폭 안에서 균등 배치 (붙어서 몰려 보이는 건 의도)
            var margin = mokokoW() / 2 + 4;
            var placeLeft = b.left + margin;
            var placeRight = b.right - margin;
            var placeW = placeRight - placeLeft;

            // 균등 간격으로 재배치
            var count = entries.length;
            for (var j = 0; j < count; j++) {
                var ratio = count > 1 ? j / (count - 1) : 0.5;
                entries[j].px = placeLeft + ratio * placeW;
            }

            entries.forEach(function(e) {
                var m = mokokos.get(e.key);
                if (m) {
                    m.pixelX = e.px;
                    if (m.el) m.el.style.left = (m.pixelX - mokokoW() / 2) + 'px';
                }
            });
        }
    }

    // ═══════════════════════════════════════════
    //  DOM RENDERING (고화질 이미지 + CSS 애니메이션)
    // ═══════════════════════════════════════════
    function createMokokoEl(key, pixelX, isMine) {
        var img = document.createElement('img');
        img.src = 'object/mokoko_seed.png';
        img.className = 'ee-char ee-mokoko sprouting';
        img.draggable = false;
        if (isMine) img.classList.add('ee-mine');
        img.style.width = mokokoW() + 'px';
        img.style.left = (pixelX - mokokoW() / 2) + 'px';
        stage.appendChild(img);
        return img;
    }

    // 바깥 div = 위치와 물리 회전(JS가 매 프레임), 안쪽 img = 스쿼시·idle 연출.
    // 한 엘리먼트에 둘을 같이 쓰면 CSS 애니메이션이 인라인 transform 을 덮어써 물리 회전이 죽는다.
    function createDosterEl(type, isMine, key) {
        var el = document.createElement('div');
        el.className = 'ee-char ee-doster';
        el.setAttribute('data-type', type);
        el.setAttribute('data-key', key);
        if (isMine) el.classList.add('ee-mine');
        el.style.width = dosterW(type) + 'px';
        // 처음엔 화면 위에 숨김
        el.style.left = '-100px';
        el.style.bottom = STAGE_HEIGHT + 'px';

        var img = document.createElement('img');
        img.src = type === 0 ? 'object/doster_a.png' : 'object/doster_b.png';
        img.className = 'ee-doster-body';
        img.draggable = false;
        el.appendChild(img);

        // 클릭 시 도망 (착지 후에만 pointer-events: auto)
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            handleDosterClick(key);
        });
        stage.appendChild(el);
        return el;
    }

    // 도스터 위치를 물리엔진 좌표 → DOM 위치로 동기화
    function syncDosterPositions() {
        dosters.forEach(function(d) {
            if (!d.body || !d.el) return;
            var pos = d.body.position;
            var angle = d.body.angle;
            var halfSize = dosterW(d.type) / 2;

            // bottom 기준 좌표 → left/bottom 변환.
            // 세로는 바디의 반높이를 써야 스프라이트 발이 바닥에 정확히 닿는다.
            var left = pos.x - halfSize;
            var bottom = STAGE_HEIGHT - pos.y - (d.body.halfH || halfSize);

            d.el.style.left = left + 'px';
            d.el.style.bottom = bottom + 'px';
            d.el.style.transform = 'rotate(' + (angle * 180 / Math.PI).toFixed(1) + 'deg)';

            // 한 번 내려앉으면 클릭은 계속 열어 둔다.
            // 자세를 고치거나 옆 도스터에 부딪혀 잠깐 깨어났다고 클릭이 막히면
            // 사용자 입장에선 "눌러도 안 되는" 상태로 보인다.
            if (d.body.isSleeping && !d.landed) {
                d.landed = true;
                d.el.classList.add('landed');
            }
        });
    }

    // ═══════════════════════════════════════════
    //  도스터 클릭 → 도망 (실시간 동기화)
    // ═══════════════════════════════════════════
    var lastFleeTime = 0;

    function handleDosterClick(key) {
        if (!db || !isActive) return;
        var now = Date.now();
        if (now - lastFleeTime < 3000) return; // 3초 쿨다운
        lastFleeTime = now;

        var dir = Math.random() < 0.5 ? 'left' : 'right';
        db.ref('users/' + key + '/flee').set({
            dir: dir,
            t: firebase.database.ServerValue.TIMESTAMP
        });
    }

    function triggerFleeAnimation(key, dir) {
        var d = dosters.get(key);
        if (!d || !d.el || d.fleeing) return;
        d.fleeing = true;
        d.el.classList.add('fleeing');

        // 물리엔진에서 제거
        if (d.body && world) {
            Matter.Composite.remove(world, d.body);
            d.body = null;
        }

        // 현재 위치 가져오기
        var currentLeft = parseFloat(d.el.style.left) || 0;
        var currentBottom = parseFloat(d.el.style.bottom) || 0;
        var eb = getScreenBounds();   // 도망은 화면 밖까지 달려야 자연스럽다
        var speed = 2.5 + Math.random() * 1.5; // 2.5~4 px/frame (절반으로 감소)
        var frameCount = 0;

        // 도망 방향 바라보기 (좌로 가면 좌측, 우로 가면 우측)
        var flipX = dir === 'left' ? 1 : -1;

        // 자연스러운 햄스터 도망: 처음에 깜짝 놀라서 멈칫 → 가속
        var startTime = performance.now();
        var hesitateMs = 150 + Math.random() * 100; // 150~250ms 멈칫

        function animateFlee(now) {
            var elapsed = now - startTime;

            // Phase 1: 깜짝 놀라서 멈칫 (약간 뒤로 움찔)
            if (elapsed < hesitateMs) {
                var flinchT = elapsed / hesitateMs;
                var flinch = Math.sin(flinchT * Math.PI) * 3; // 살짝 반대로 움찔
                d.el.style.left = (currentLeft + (dir === 'left' ? flinch : -flinch)) + 'px';
                d.el.style.transform = 'scaleX(' + flipX + ') rotate(' + (flinchT * -8) + 'deg)';
                requestAnimationFrame(animateFlee);
                return;
            }

            // Phase 2: 도망 (천천히 가속)
            frameCount++;
            var accel = Math.min(frameCount / 30, 1); // 30프레임에 걸쳐 가속
            var currentSpeed = speed * (0.3 + 0.7 * accel);
            currentLeft += (dir === 'left' ? -currentSpeed : currentSpeed);

            // 작고 빠른 종종걸음 바운스
            var hopFreq = 0.25 + accel * 0.15; // 가속할수록 빠른 발걸음
            var hopHeight = 5 + accel * 4; // 가속하면 점프 높이도 증가
            var hop = Math.abs(Math.sin(frameCount * hopFreq)) * hopHeight;

            // 몸통 좌우 흔들림 (뒤뚱뒤뚱)
            var wobble = Math.sin(frameCount * 0.3) * (4 + accel * 3);

            d.el.style.left = currentLeft + 'px';
            d.el.style.bottom = (currentBottom + hop) + 'px';
            d.el.style.transform = 'scaleX(' + flipX + ') rotate(' + wobble + 'deg)';

            // 화면 밖 도달 시 제거
            if ((dir === 'left' && currentLeft < eb.left - 80) || (dir === 'right' && currentLeft > eb.right + 50)) {
                if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
                dosters.delete(key);
                return;
            }
            requestAnimationFrame(animateFlee);
        }
        requestAnimationFrame(animateFlee);
    }

    // 캐릭터라 옆으로 누우면 쓰러진 것처럼 보인다. 서 있는 자세로 아주 약하게 되돌리는 토크.
    // 스프링(각도) + 댐퍼(각속도) 조합이라 기울다가 스르르 자세를 잡는다. 살짝 기운 맛은 남는다.
    var UPRIGHT_SPRING = 0.00018;
    var UPRIGHT_DAMP = 0.0026;
    var UPRIGHT_TOLERANCE = 0.5;   // 28도까지는 기울어도 그대로 둔다 (쌓였을 땐 자연스럽다)
    var UPRIGHT_GIVEUP_MS = 2500;  // 이만큼 애써도 못 세우면 포기 — 계속 밀면 영영 잠들지 못한다
    function keepUpright() {
        var now = performance.now();
        dosters.forEach(function (d) {
            var b = d.body;
            if (!b || d.fleeing) return;
            var a = Math.atan2(Math.sin(b.angle), Math.cos(b.angle));   // -π~π 로 정규화

            // 허용 범위 안이면 손대지 않는다. 계속 토크를 주면 미세하게 움직여 잠들지 못하고,
            // 잠들지 못하면 landed 가 붙지 않아 클릭조차 되지 않는다.
            if (Math.abs(a) < UPRIGHT_TOLERANCE) { d.uprightSince = 0; return; }

            if (!d.uprightSince) d.uprightSince = now;
            if (now - d.uprightSince > UPRIGHT_GIVEUP_MS) return;   // 눌려서 못 세우는 자세는 인정

            if (b.isSleeping) {
                // 누운 채로 잠들면 토크가 닿지 않는다. 꿈틀하며 스스로 일어나도록 살짝 튕겨 준다.
                Matter.Sleeping.set(b, false);
                Matter.Body.setAngularVelocity(b, (a > 0 ? -1 : 1) * 0.12);
                Matter.Body.applyForce(b, b.position, { x: 0, y: -0.004 * b.mass });
            }
            b.torque += (-a * UPRIGHT_SPRING - b.angularVelocity * UPRIGHT_DAMP) * b.mass;
        });
    }

    // rAF 는 모니터 주사율만큼 불린다. 매 호출마다 16.67ms 를 밀면 144Hz 에서 물리가 2.4배 빨라지므로,
    // 실제 흐른 시간을 모아 고정 간격으로 나눠 돌린다 (Matter.Runner 와 같은 방식).
    var FIXED_DELTA = 1000 / 60;
    var physicsAcc = 0;
    var lastFrameT = 0;

    function render(now) {
        if (!isActive) return;
        if (hasPendingUpdates) processPendingUpdates();

        var t = now || performance.now();
        var frameDelta = lastFrameT ? Math.min(t - lastFrameT, 100) : FIXED_DELTA;
        lastFrameT = t;

        if (hasAwakeBodies()) {
            physicsAcc = Math.min(physicsAcc + frameDelta, 200);
            for (var steps = 0; physicsAcc >= FIXED_DELTA && steps < 5; steps++) {
                keepUpright();
                Matter.Engine.update(engine, FIXED_DELTA);
                physicsAcc -= FIXED_DELTA;
            }
        } else {
            physicsAcc = 0;
        }
        syncDosterPositions();

        if (isTabVisible && isActive) {
            animFrameId = requestAnimationFrame(render);
        }
    }

    // ═══════════════════════════════════════════
    //  BATCH PROCESSING
    // ═══════════════════════════════════════════
    function processPendingUpdates() {
        var i;
        for (i = 0; i < pendingAdds.length; i++)
            addCharacter(pendingAdds[i].key, pendingAdds[i].data);
        pendingAdds = [];
        for (i = 0; i < pendingRemoves.length; i++)
            removeCharacter(pendingRemoves[i]);
        pendingRemoves = [];
        hasPendingUpdates = false;
    }

    // 도스터 헤더 낙하 Phase 1: fixed overlay에서 CSS 애니메이션
    function startDosterFall(key, data, isMine) {
        var overlay = document.getElementById('doster-fall-overlay');
        if (!overlay || !stage) {
            finishDosterFall(key, data, isMine);
            return;
        }

        var type = data.doster.type;
        var img = document.createElement('img');
        img.src = type === 0 ? 'object/doster_a.png' : 'object/doster_b.png';
        img.className = 'doster-falling';
        img.draggable = false;
        var size = dosterW(type);
        img.style.width = size + 'px';
        img.style.height = 'auto';

        // 오버레이도 같은 배율 안에 있으므로 화면 좌표를 로컬 px 로 환산해서 쓴다
        var stageRect = stage.getBoundingClientRect();
        var startX = toLocal(stageRect.left + data.doster.x * stageRect.width) - size / 2;
        img.style.left = startX + 'px';
        img.style.top = '60px';
        img.style.opacity = '0';

        // 타겟 Y: 스테이지 상단 (뷰포트 기준)
        // 스테이지 하단 = 푸터선, ground는 스테이지 바닥에 있으므로
        // 도스터가 스테이지 영역 상단에 도달하면 Phase 2로 전환
        var targetY = toLocal(stageRect.top);
        var fallDist = Math.max(targetY - 60, 100); // 최소 100px은 낙하
        var fallDuration = Math.max(700, Math.min(1300, fallDist * 1.0));

        var startTime = performance.now();
        var totalRotation = (Math.random() - 0.5) * 360;

        overlay.appendChild(img);

        function animateFall(now) {
            var t = Math.min((now - startTime) / fallDuration, 1);
            // 중력 가속 느낌 (power curve)
            var eased = Math.pow(t, 1.8);
            var currentY = 60 + fallDist * eased;
            var rot = totalRotation * eased;

            img.style.top = currentY + 'px';
            img.style.opacity = t < 0.08 ? String(t / 0.08) : '1';
            img.style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';

            if (t < 1) {
                requestAnimationFrame(animateFall);
            } else {
                // 낙하 완료 → overlay 요소 제거 → Phase 2 (스테이지 Matter.js)
                if (img.parentNode) img.parentNode.removeChild(img);
                finishDosterFall(key, data, isMine);
            }
        }
        requestAnimationFrame(animateFall);
    }

    // 도스터 헤더 낙하 Phase 2: 스테이지 Matter.js 바운스
    function finishDosterFall(key, data, isMine) {
        if (dosters.has(key)) return;
        var body = createDosterBody(data.doster.x, data.doster.type);
        var dEl = createDosterEl(data.doster.type, isMine, key);
        body.dosterKey = key;   // 충돌 이벤트에서 도스터를 O(1) 로 찾기 위한 역참조
        dosters.set(key, { body: body, type: data.doster.type, el: dEl, inner: dEl.firstChild, landed: false });
    }

    function addCharacter(key, data) {
        var isMine = key === myFingerprint;

        if (data.charType === 'mokoko' && data.mokoko && !mokokos.has(key)) {
            var w = stage ? stage.offsetWidth : window.innerWidth;
            var px = data.mokoko.x * w;
            var el = createMokokoEl(key, px, isMine);
            mokokos.set(key, { normalizedX: data.mokoko.x, pixelX: px, el: el });
            recalculateMokokoPositions();
        } else if (data.charType === 'doster' && data.doster && !dosters.has(key)) {
            startDosterFall(key, data, isMine);
        }
    }

    function removeCharacter(key) {
        var m = mokokos.get(key);
        if (m && m.el && m.el.parentNode) {
            m.el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            m.el.style.opacity = '0';
            m.el.style.transform = 'scale(0.3)';
            setTimeout(function() { if (m.el.parentNode) m.el.parentNode.removeChild(m.el); }, 400);
        }
        mokokos.delete(key);

        var d = dosters.get(key);
        if (d) {
            if (d.body && world) Matter.Composite.remove(world, d.body);
            if (d.el && d.el.parentNode) {
                d.el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                d.el.style.opacity = '0';
                d.el.style.transform = 'scale(0.3)';
                setTimeout(function() { if (d.el.parentNode) d.el.parentNode.removeChild(d.el); }, 400);
            }
        }
        dosters.delete(key);
        recalculateMokokoPositions();
    }

    // ═══════════════════════════════════════════
    //  DATA VALIDATION (보안)
    // ═══════════════════════════════════════════
    function validateUserData(data) {
        if (!data || typeof data !== 'object') return false;
        if (typeof data.charType !== 'string') return false;
        if (data.charType !== 'mokoko' && data.charType !== 'doster') return false;
        if (data.charType === 'mokoko') {
            if (!data.mokoko || typeof data.mokoko.x !== 'number') return false;
            if (data.mokoko.x < 0 || data.mokoko.x > 1) return false;
        }
        if (data.charType === 'doster') {
            if (!data.doster || typeof data.doster.x !== 'number') return false;
            if (data.doster.x < 0 || data.doster.x > 1) return false;
            if (data.doster.type !== 0 && data.doster.type !== 1) return false;
        }
        // flee 필드는 옵셔널 — 있으면 dir만 검증
        if (data.flee && data.flee.dir !== 'left' && data.flee.dir !== 'right') return false;
        return true;
    }

    function canWrite() {
        var now = Date.now();
        if (now - lastWriteTime < 5000) return false;
        lastWriteTime = now;
        return true;
    }

    // ═══════════════════════════════════════════
    //  FIREBASE PRESENCE
    // ═══════════════════════════════════════════
    async function initFirebase() {
        if (!firebaseInitialized) {
            var config;
            try {
                var response = await fetch('/api/firebase-config');
                if (!response.ok) throw new Error('HTTP ' + response.status);
                config = await response.json();
            } catch (e) {
                console.error('Firebase 설정을 불러오지 못했습니다:', e);
                return false;
            }
            firebase.initializeApp(config);
            firebaseInitialized = true;
        }
        db = firebase.database();
        usersRef = db.ref('users');
        return true;
    }

    // 페이지를 옮기면 연결이 끊겨 내 기록이 지워지고 새 좌표가 뽑힌다.
    // 좌표를 남겨 두고 다시 쓰면 다른 페이지에서도 같은 자리에 선다.
    // sessionStorage 라 탭을 닫으면 초기화된다 — 방문할 때마다 새로 자리를 잡는 재미는 그대로 둔다.
    var MY_POS_KEY = 'loa_easter_pos';
    function loadMyPos() {
        try {
            var v = JSON.parse(sessionStorage.getItem(MY_POS_KEY) || 'null');
            if (!v || typeof v.x !== 'number' || !(v.x >= 0 && v.x <= 1)) return null;
            if (v.charType === 'mokoko') return { charType: 'mokoko', x: v.x };
            if (v.charType === 'doster' && (v.type === 0 || v.type === 1)) return v;
            return null;
        } catch (e) { return null; }
    }
    function saveMyPos(v) {
        try { sessionStorage.setItem(MY_POS_KEY, JSON.stringify(v)); } catch (e) {}
    }

    function registerPresence() {
        if (isMobile() || isSpectator || !canWrite()) return;
        myUserRef = db.ref('users/' + myFingerprint);

        myUserRef.once('value', function(snapshot) {
            if (snapshot.exists()) { isSpectator = true; return; }

            var mine = loadMyPos();
            if (!mine) {
                mine = Math.random() < 0.5
                    ? { charType: 'mokoko', x: 0.05 + Math.random() * 0.9 }
                    : { charType: 'doster', type: Math.random() < 0.5 ? 0 : 1, x: 0.1 + Math.random() * 0.8 };
                saveMyPos(mine);
            }

            var userData = mine.charType === 'mokoko'
                ? { charType: 'mokoko', mokoko: { x: mine.x }, timestamp: firebase.database.ServerValue.TIMESTAMP }
                : { charType: 'doster', doster: { type: mine.type, x: mine.x }, timestamp: firebase.database.ServerValue.TIMESTAMP };

            myUserRef.onDisconnect().remove();
            myUserRef.set(userData);
        });
    }

    function listenForUsers() {
        firebaseQuery = usersRef.orderByChild('timestamp').limitToLast(MAX_USERS);
        firebaseQuery.on('child_added', function(snap) {
            var data = snap.val();
            if (!data || !validateUserData(data)) return;
            pendingAdds.push({ key: snap.key, data: data });
            hasPendingUpdates = true;
        });
        firebaseQuery.on('child_removed', function(snap) {
            pendingRemoves.push(snap.key);
            hasPendingUpdates = true;
        });
        firebaseQuery.on('child_changed', function(snap) {
            var data = snap.val();
            if (data && data.flee && (data.flee.dir === 'left' || data.flee.dir === 'right')) {
                triggerFleeAnimation(snap.key, data.flee.dir);
            }
        });
    }

    function monitorConnection() {
        db.ref('.info/connected').on('value', function(snap) {
            if (snap.val() === true) {
                isConnected = true;
                if (!isSpectator && myUserRef) myUserRef.onDisconnect().remove();
            } else {
                isConnected = false;
            }
        });
    }

    function checkAndRegister() {
        usersRef.once('value').then(function(snap) {
            if (snap.numChildren() >= MAX_USERS) isSpectator = true;
            else registerPresence();
        });
    }

    // ═══════════════════════════════════════════
    //  RESIZE / VISIBILITY
    // ═══════════════════════════════════════════
    var resizeTimer = null;

    function handleResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            if (isMobile()) {
                if (myUserRef && !isSpectator) myUserRef.remove();
                if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
                return;
            }
            invalidateStageRect();
            updatePhysicsBounds();
            restyleCharacters();
            recalculateMokokoPositions();
            if (!animFrameId && isTabVisible && isActive) {
                animFrameId = requestAnimationFrame(render);
            }
        }, 200);
    }

    function handleVisibility() {
        if (document.visibilityState === 'hidden') {
            isTabVisible = false;
            if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        } else {
            isTabVisible = true;
            lastFrameT = 0;   // 숨어 있던 시간이 물리에 한꺼번에 반영되지 않도록
            if (!animFrameId && !isMobile() && isActive)
                animFrameId = requestAnimationFrame(render);
        }
    }

    function cleanup() {
        if (myUserRef && !isSpectator) myUserRef.remove();
        if (animFrameId) cancelAnimationFrame(animFrameId);
    }

    // ═══════════════════════════════════════════
    //  도스터 idle 애니메이션 (로컬 전용)
    // ═══════════════════════════════════════════
    var idleIntervalId = null;
    var IDLE_CLASSES = ['idle-1', 'idle-2', 'idle-3'];

    function startIdleLoop() {
        if (idleIntervalId) return;
        idleIntervalId = setInterval(function() {
            if (!isActive || dosters.size === 0) return;
            // 랜덤 도스터 하나 선택
            var candidates = [];
            dosters.forEach(function(d) {
                if (d.landed && !d.fleeing && d.inner) candidates.push(d);
            });
            if (candidates.length === 0) return;
            var pick = candidates[Math.floor(Math.random() * candidates.length)];

            // 가끔은 진짜로 뒤척이게 — 한 번 잠들면 박제되는 걸 막는다
            if (pick.body && Math.random() < 0.3) {
                if (pick.body.isSleeping) Matter.Sleeping.set(pick.body, false);
                Matter.Body.applyForce(pick.body, pick.body.position, {
                    x: (Math.random() - 0.5) * 0.0006 * pick.body.mass,
                    y: -0.0012 * pick.body.mass
                });
                return;
            }

            var cls = IDLE_CLASSES[Math.floor(Math.random() * IDLE_CLASSES.length)];
            pick.inner.classList.add(cls);
            pick.inner.addEventListener('animationend', function handler() {
                pick.inner.classList.remove(cls);
                pick.inner.removeEventListener('animationend', handler);
            });
        }, 10000 + Math.random() * 5000); // 10~15초 간격
    }

    function stopIdleLoop() {
        if (idleIntervalId) { clearInterval(idleIntervalId); idleIntervalId = null; }
    }

    // ═══════════════════════════════════════════
    //  커서 밀어내기 (로컬 전용)
    //  — 예전 '시선 추적'은 값을 계산만 하고 화면에 반영하는 코드가 없어 동작하지 않았다.
    //    기울이는 대신 실제로 힘을 줘서 물리적으로 밀리게 한다.
    // ═══════════════════════════════════════════
    var PUSH_DIST = 90;         // 반응 범위 (화면 px)
    var PUSH_FORCE = 0.0018;    // 밀어내는 힘
    var pushRectCache = null;
    var lastPushT = 0;

    function invalidateStageRect() { pushRectCache = null; }

    function handleGlobalMouseMove(e) {
        if (!stage || !isActive || !world || dosters.size === 0) return;

        var now = performance.now();
        if (now - lastPushT < 40) return;   // 초당 25회로 제한
        lastPushT = now;

        // getBoundingClientRect 는 강제 레이아웃을 부르므로 캐시하고 스크롤·리사이즈에만 버린다
        if (!pushRectCache) pushRectCache = stage.getBoundingClientRect();
        var r = pushRectCache;
        if (e.clientY < r.top - PUSH_DIST || e.clientY > r.bottom + PUSH_DIST) return;

        var mx = toLocal(e.clientX - r.left);
        var my = toLocal(e.clientY - r.top);    // 스테이지 로컬 = 물리 좌표계
        var reach = toLocal(PUSH_DIST);

        dosters.forEach(function(d) {
            if (!d.body || d.fleeing) return;
            var pos = d.body.position;
            var dx = pos.x - mx, dy = pos.y - my;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > reach || dist < 0.001) return;
            var power = (1 - dist / reach) * PUSH_FORCE * d.body.mass;
            if (d.body.isSleeping) Matter.Sleeping.set(d.body, false);
            Matter.Body.applyForce(d.body, pos, { x: (dx / dist) * power, y: (dy / dist) * power });
        });
    }

    async function activate() {
        if (isActive) return;
        isActive = true;
        if (!stage) stage = document.getElementById('easter-egg-stage');
        if (stage) stage.style.display = '';
        if (isMobile()) return;

        myFingerprint = myFingerprint || getDeviceFingerprint();
        initPhysics();
        var ok = await initFirebase();
        if (!ok) return;
        listenForUsers();
        monitorConnection();
        checkAndRegister();
        animFrameId = requestAnimationFrame(render);
        startIdleLoop();
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('scroll', invalidateStageRect, { passive: true });
    }

    function deactivate() {
        if (!isActive) return;
        isActive = false;

        if (stage) {
            stage.style.display = 'none';
            // 모든 자식 요소 제거
            while (stage.firstChild) stage.removeChild(stage.firstChild);
        }
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (myUserRef && !isSpectator) myUserRef.remove();
        if (firebaseQuery) { firebaseQuery.off(); firebaseQuery = null; }

        if (engine) {
            Matter.Engine.clear(engine);
            engine = null; world = null;
            ground = null; wallLeft = null; wallRight = null;
        }

        mokokos.clear();
        dosters.clear();
        pendingAdds = [];
        pendingRemoves = [];
        myUserRef = null;
        isSpectator = false;
        isConnected = false;
        stopIdleLoop();
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('scroll', invalidateStageRect);
    }

    // ═══════════════════════════════════════════
    //  잭팟 컨페티 시스템
    // ═══════════════════════════════════════════
    var confettiCanvas = null;
    var confettiCtx = null;
    var confettiParticles = [];
    var confettiAnimId = null;

    var CONFETTI_COLORS_NORMAL = ['#FFD700', '#FFA500', '#FFFFFF', '#FFE066', '#FFCC33'];
    var CONFETTI_COLORS_BIG = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD', '#FFA500', '#FFFFFF'];

    function initConfettiCanvas() {
        confettiCanvas = document.getElementById('confetti-canvas');
        if (!confettiCanvas) return;
        confettiCtx = confettiCanvas.getContext('2d');
    }

    function fireConfetti(intensity) {
        if (!confettiCanvas) initConfettiCanvas();
        if (!confettiCanvas || !confettiCtx) return;

        var isBig = intensity === 'big';
        var count = isBig ? (100 + Math.floor(Math.random() * 50)) : (30 + Math.floor(Math.random() * 20));
        var colors = isBig ? CONFETTI_COLORS_BIG : CONFETTI_COLORS_NORMAL;
        var duration = isBig ? 3000 : 1500;

        confettiCanvas.width = window.innerWidth;
        confettiCanvas.height = window.innerHeight;
        confettiCanvas.style.display = 'block';

        var startTime = performance.now();

        for (var i = 0; i < count; i++) {
            confettiParticles.push({
                x: Math.random() * confettiCanvas.width,
                y: -10 - Math.random() * confettiCanvas.height * 0.3,
                vx: (Math.random() - 0.5) * (isBig ? 8 : 4),
                vy: Math.random() * 2 + 1,
                size: isBig ? (4 + Math.random() * 8) : (3 + Math.random() * 5),
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 10,
                shape: Math.floor(Math.random() * 3), // 0=rect, 1=circle, 2=star
                opacity: 1,
                gravity: 0.08 + Math.random() * 0.04,
                drag: 0.98 + Math.random() * 0.015
            });
        }

        if (confettiAnimId) cancelAnimationFrame(confettiAnimId);

        function drawStar(ctx, cx, cy, r, rot) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rot * Math.PI / 180);
            ctx.beginPath();
            for (var i = 0; i < 5; i++) {
                var angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
                var method = i === 0 ? 'moveTo' : 'lineTo';
                ctx[method](Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        function animateConfetti(now) {
            var elapsed = now - startTime;
            var fadeStart = duration * 0.6;
            confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

            var alive = false;
            for (var i = confettiParticles.length - 1; i >= 0; i--) {
                var p = confettiParticles[i];
                p.vy += p.gravity;
                p.vx *= p.drag;
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.rotSpeed;

                if (elapsed > fadeStart) {
                    p.opacity = Math.max(0, 1 - (elapsed - fadeStart) / (duration - fadeStart));
                }

                if (p.opacity <= 0 || p.y > confettiCanvas.height + 20) {
                    confettiParticles.splice(i, 1);
                    continue;
                }
                alive = true;

                confettiCtx.globalAlpha = p.opacity;
                confettiCtx.fillStyle = p.color;

                if (p.shape === 0) {
                    confettiCtx.save();
                    confettiCtx.translate(p.x, p.y);
                    confettiCtx.rotate(p.rotation * Math.PI / 180);
                    confettiCtx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                    confettiCtx.restore();
                } else if (p.shape === 1) {
                    confettiCtx.beginPath();
                    confettiCtx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
                    confettiCtx.fill();
                } else {
                    drawStar(confettiCtx, p.x, p.y, p.size / 2, p.rotation);
                }
            }

            confettiCtx.globalAlpha = 1;

            if (alive && elapsed < duration + 500) {
                confettiAnimId = requestAnimationFrame(animateConfetti);
            } else {
                confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
                confettiCanvas.style.display = 'none';
                confettiParticles = [];
                confettiAnimId = null;
            }
        }
        confettiAnimId = requestAnimationFrame(animateConfetti);
    }

    function triggerCharacterJump(intensity) {
        var isBig = intensity === 'big';

        // 모코코 점프
        mokokos.forEach(function(m) {
            if (!m.el) return;
            m.el.classList.remove('jumping', 'jumping-big', 'sprouting');
            void m.el.offsetWidth; // reflow to restart animation
            m.el.classList.add(isBig ? 'jumping-big' : 'jumping');
            m.el.addEventListener('animationend', function handler() {
                m.el.classList.remove('jumping', 'jumping-big');
                m.el.removeEventListener('animationend', handler);
            });
        });

        // 도스터 물리 점프
        dosters.forEach(function(d) {
            if (!d.body || !d.landed || d.fleeing) return;
            Matter.Sleeping.set(d.body, false);
            var force = isBig ? -0.025 : -0.012;
            Matter.Body.applyForce(d.body, d.body.position, { x: (Math.random() - 0.5) * 0.005, y: force });
            d.landed = false;
            d.el.classList.remove('landed');
            // 렌더 루프가 멈춰있을 수 있으므로 재시작
            if (!animFrameId && isTabVisible && isActive) {
                animFrameId = requestAnimationFrame(render);
            }
        });
    }

    function jackpot(intensity) {
        if (!isActive) return;
        fireConfetti(intensity);
        triggerCharacterJump(intensity);
    }

    // ═══════════════════════════════════════════
    //  아이템 비 시스템
    // ═══════════════════════════════════════════
    var itemRainActive = false;
    var itemRainTimer = null;
    // 이미지: 아비도스/상급 + 도스터 (낮은 확률 이스터에그)
    var RAIN_IMAGES = [
        { src: 'https://cdn-lostark.game.onstove.com/efui_iconatlas/use/use_12_86.png', sizeMin: 26, sizeMax: 40, weight: 49 },
        { src: 'https://cdn-lostark.game.onstove.com/EFUI_IconAtlas/Use/Use_13_252.png', sizeMin: 19, sizeMax: 29, weight: 49 },
        { src: 'object/doster_a.png', sizeMin: 20, sizeMax: 28, weight: 1 },
        { src: 'object/doster_b.png', sizeMin: 22, sizeMax: 30, weight: 1 }
    ];
    var RAIN_TOTAL_WEIGHT = 100;

    function pickRainImage() {
        var r = Math.random() * RAIN_TOTAL_WEIGHT;
        var acc = 0;
        for (var i = 0; i < RAIN_IMAGES.length; i++) {
            acc += RAIN_IMAGES[i].weight;
            if (r < acc) return RAIN_IMAGES[i];
        }
        return RAIN_IMAGES[0];
    }

    // 전체 화면에 균등하게 떨어짐 (패널 위는 z-index로 가려짐)
    function getRainX(itemSize) {
        return Math.random() * (window.innerWidth - itemSize);
    }

    function startItemRain() {
        if (itemRainActive) return;
        itemRainActive = true;
        var layer = document.getElementById('item-rain-layer');
        if (!layer) return;

        function spawnItem() {
            if (!itemRainActive || !isActive) return;

            var imgInfo = pickRainImage();
            var img = document.createElement('img');
            img.src = imgInfo.src;
            img.className = 'rain-item';
            img.draggable = false;
            var size = imgInfo.sizeMin + Math.floor(Math.random() * (imgInfo.sizeMax - imgInfo.sizeMin + 1));
            img.style.width = size + 'px';
            img.style.height = size + 'px';
            img.style.left = getRainX(size) + 'px';
            img.style.opacity = '0';

            var fallDuration = 3000 + Math.random() * 2000;
            var swayAmount = (Math.random() - 0.5) * 60;
            var rotEnd = (Math.random() - 0.5) * 180;

            img.style.animation = 'itemFall ' + fallDuration + 'ms linear forwards';

            var startTime = performance.now();
            var fallRafId = null;

            function animateRainItem(now) {
                var t = (now - startTime) / fallDuration;
                if (t > 1) {
                    if (img.parentNode) img.parentNode.removeChild(img);
                    return;
                }
                var sway = Math.sin(t * Math.PI * 3) * swayAmount * (1 - t * 0.5);
                var rot = rotEnd * t;
                img.style.transform = 'translateX(' + sway + 'px) rotate(' + rot + 'deg)';
                fallRafId = requestAnimationFrame(animateRainItem);
            }

            layer.appendChild(img);
            fallRafId = requestAnimationFrame(animateRainItem);

            img.addEventListener('animationend', function() {
                if (fallRafId) cancelAnimationFrame(fallRafId);
                if (img.parentNode) img.parentNode.removeChild(img);
            });
        }

        // 타이머 체이닝 (setInterval 대신) — 중단 시 확실하게 멈춤
        function scheduleNext() {
            if (!itemRainActive || !isActive) return;
            itemRainTimer = setTimeout(function() {
                if (!itemRainActive || !isActive) return;
                spawnItem();
                scheduleNext();
            }, 200 + Math.random() * 180);
        }

        spawnItem();
        scheduleNext();
    }

    function stopItemRain() {
        itemRainActive = false;
        if (itemRainTimer) {
            clearTimeout(itemRainTimer);
            itemRainTimer = null;
        }
    }

    // ═══════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════
    window.LoaDossEasterEgg = {
        toggle: function(state) {
            if (state === undefined) state = !isActive;
            if (state) activate(); else deactivate();
        },
        isActive: function() { return isActive; },
        jackpot: function(intensity) { jackpot(intensity); },
        itemRain: function(active) { if (active) startItemRain(); else stopItemRain(); }
    };

    // ═══════════════════════════════════════════
    //  LIFECYCLE
    // ═══════════════════════════════════════════
    async function init() {
        var pref = localStorage.getItem('loa_easter');
        if (pref === 'off') {
            isActive = false;
            stage = document.getElementById('easter-egg-stage');
            if (stage) stage.style.display = 'none';
            return;
        }
        if (isMobile()) return;

        myFingerprint = getDeviceFingerprint();
        stage = document.getElementById('easter-egg-stage');
        if (!stage) return;

        initPhysics();
        var ok = await initFirebase();
        if (!ok) return;
        listenForUsers();
        monitorConnection();
        checkAndRegister();

        animFrameId = requestAnimationFrame(render);

        // idle 애니메이션 + 커서 근접 반응 시작
        startIdleLoop();
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('scroll', invalidateStageRect, { passive: true });

        window.addEventListener('resize', handleResize);
        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('beforeunload', cleanup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

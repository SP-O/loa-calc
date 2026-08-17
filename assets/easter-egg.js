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

    // 크기: 모코코 -10%, 도스터 -30%
    var MOKOKO_WIDTH = 32;       // 36 * 0.9 ≈ 32
    var MOKOKO_MIN_GAP = 6;
    var DOSTER_SIZE = [36, 36];  // [22*2*0.7, 26*2*0.7] ≈ [31, 36]
    var DOSTER_PHYS_R = [18, 18]; // 물리 충돌 반지름

    // 도스터 중력 절반
    var PHYSICS = {
        gravity: { x: 0, y: 0.3 },
        restitution: 0.65,
        friction: 0.5,
        frictionAir: 0.025,
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
        updatePhysicsBounds();
    }

    // 스테이지 로컬 좌표에서 화면 왼쪽/오른쪽 끝까지의 거리 계산
    function getExtendedBounds() {
        var stageW = stage ? stage.offsetWidth : window.innerWidth;
        var rect = stage ? stage.getBoundingClientRect() : { left: 0 };
        var stageLeft = rect.left;                       // 스테이지 왼쪽 → 화면 왼쪽 거리
        var stageRight = window.innerWidth - stageLeft;  // 스테이지 왼쪽 기준 → 화면 오른쪽 끝
        return { stageW: stageW, left: -stageLeft, right: stageRight };
    }

    function updatePhysicsBounds() {
        if (!world) return;
        var b = getExtendedBounds();
        if (ground) Matter.Composite.remove(world, ground);
        if (wallLeft) Matter.Composite.remove(world, wallLeft);
        if (wallRight) Matter.Composite.remove(world, wallRight);

        var totalW = b.right - b.left;
        var centerX = (b.left + b.right) / 2;
        ground = Matter.Bodies.rectangle(centerX, STAGE_HEIGHT + 5, totalW + 100, 10, { isStatic: true });
        wallLeft = Matter.Bodies.rectangle(b.left - 5, STAGE_HEIGHT / 2, 10, STAGE_HEIGHT * 3, { isStatic: true });
        wallRight = Matter.Bodies.rectangle(b.right + 5, STAGE_HEIGHT / 2, 10, STAGE_HEIGHT * 3, { isStatic: true });
        Matter.Composite.add(world, [ground, wallLeft, wallRight]);
    }

    function createDosterBody(normalizedX, type) {
        var w = stage ? stage.offsetWidth : window.innerWidth;
        var x = normalizedX * w;
        var radius = DOSTER_PHYS_R[type] || DOSTER_PHYS_R[0];

        var body = Matter.Bodies.circle(x, -40, radius, {
            restitution: PHYSICS.restitution,
            friction: PHYSICS.friction,
            frictionAir: PHYSICS.frictionAir,
            density: PHYSICS.density
        });
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
        var slotW = MOKOKO_WIDTH + MOKOKO_MIN_GAP;
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
        var maxNStage = 1 - (MOKOKO_WIDTH / 2) / stageW;
        var fitsInStage = last.nx <= maxNStage;

        if (fitsInStage) {
            // 스테이지 내부에서 clamp
            var minN = (MOKOKO_WIDTH / 2) / stageW;
            for (var k = 0; k < entries.length; k++) {
                if (entries[k].nx < minN) entries[k].nx = minN;
            }
            entries.forEach(function(e) {
                var m = mokokos.get(e.key);
                if (m) {
                    m.pixelX = e.nx * stageW;
                    if (m.el) m.el.style.left = (m.pixelX - MOKOKO_WIDTH / 2) + 'px';
                }
            });
        } else {
            // 오버플로우 — 화면 전체 너비로 확장 배치
            // normalizedX(0~1)를 화면 전체 범위(b.left ~ b.right)로 리매핑
            var margin = MOKOKO_WIDTH / 2 + 4;
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
                    if (m.el) m.el.style.left = (m.pixelX - MOKOKO_WIDTH / 2) + 'px';
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
        img.style.left = (pixelX - MOKOKO_WIDTH / 2) + 'px';
        stage.appendChild(img);
        return img;
    }

    function createDosterEl(type, isMine, key) {
        var img = document.createElement('img');
        img.src = type === 0 ? 'object/doster_a.png' : 'object/doster_b.png';
        img.className = 'ee-char ee-doster';
        img.draggable = false;
        img.setAttribute('data-type', type);
        img.setAttribute('data-key', key);
        if (isMine) img.classList.add('ee-mine');
        // 처음엔 화면 위에 숨김
        img.style.left = '-100px';
        img.style.bottom = STAGE_HEIGHT + 'px';
        // 클릭 시 도망 (착지 후에만 pointer-events: auto)
        img.addEventListener('click', function(e) {
            e.stopPropagation();
            handleDosterClick(key);
        });
        stage.appendChild(img);
        return img;
    }

    // 도스터 위치를 물리엔진 좌표 → DOM 위치로 동기화
    function syncDosterPositions() {
        dosters.forEach(function(d) {
            if (!d.body || !d.el) return;
            var pos = d.body.position;
            var angle = d.body.angle;
            var size = DOSTER_SIZE[d.type] || DOSTER_SIZE[0];
            var halfSize = size / 2;

            // bottom 기준 좌표 → left/bottom 변환
            var left = pos.x - halfSize;
            var bottom = STAGE_HEIGHT - pos.y - halfSize;

            d.el.style.left = left + 'px';
            d.el.style.bottom = bottom + 'px';
            d.el.style.transform = 'rotate(' + (angle * 180 / Math.PI).toFixed(1) + 'deg)';

            // 착지/충돌 감지
            if (d.body.isSleeping && !d.landed) {
                // 안착: 통통 바운스 + 클릭 가능
                d.landed = true;
                d.el.classList.add('landed');
            } else if (!d.body.isSleeping && d.landed && !d.fleeing) {
                // 다른 도스터에 맞아서 다시 깨어남 → landed 해제
                d.landed = false;
                d.el.classList.remove('landed');
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
        var eb = getExtendedBounds();
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

    function render() {
        if (!isActive) return;
        if (hasPendingUpdates) processPendingUpdates();

        if (hasAwakeBodies()) {
            Matter.Engine.update(engine, 1000 / 60);
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
        var size = DOSTER_SIZE[type] || DOSTER_SIZE[0];
        img.style.width = size + 'px';
        img.style.height = 'auto';

        // X 위치 (스테이지 기준)
        var stageRect = stage.getBoundingClientRect();
        var startX = stageRect.left + data.doster.x * stageRect.width - size / 2;
        img.style.left = startX + 'px';
        img.style.top = '60px';
        img.style.opacity = '0';

        // 타겟 Y: 스테이지 상단 (뷰포트 기준)
        // 스테이지 하단 = 푸터선, ground는 스테이지 바닥에 있으므로
        // 도스터가 스테이지 영역 상단에 도달하면 Phase 2로 전환
        var targetY = stageRect.top;
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
        dosters.set(key, { body: body, type: data.doster.type, el: dEl, landed: false });
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

    function registerPresence() {
        if (isMobile() || isSpectator || !canWrite()) return;
        myUserRef = db.ref('users/' + myFingerprint);

        myUserRef.once('value', function(snapshot) {
            if (snapshot.exists()) { isSpectator = true; return; }

            var isMokokoType = Math.random() < 0.5;
            var userData;
            if (isMokokoType) {
                userData = {
                    charType: 'mokoko',
                    mokoko: { x: 0.05 + Math.random() * 0.9 },
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                };
            } else {
                userData = {
                    charType: 'doster',
                    doster: { type: Math.random() < 0.5 ? 0 : 1, x: 0.1 + Math.random() * 0.8 },
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                };
            }
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
            updatePhysicsBounds();
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
            dosters.forEach(function(d, key) {
                if (d.landed && !d.fleeing && d.el && Math.abs(d.gazeCurRot || 0) < 1) {
                    candidates.push(d);
                }
            });
            if (candidates.length === 0) return;
            var pick = candidates[Math.floor(Math.random() * candidates.length)];
            var cls = IDLE_CLASSES[Math.floor(Math.random() * IDLE_CLASSES.length)];
            pick.el.classList.add(cls);
            pick.el.addEventListener('animationend', function handler() {
                pick.el.classList.remove(cls);
                pick.el.removeEventListener('animationend', handler);
            });
        }, 10000 + Math.random() * 5000); // 10~15초 간격
    }

    function stopIdleLoop() {
        if (idleIntervalId) { clearInterval(idleIntervalId); idleIntervalId = null; }
    }

        // ═══════════════════════════════════════════
    //  커서 시선 추적 (로컬 전용)
    //  — 도스터가 마우스 방향을 쳐다보듯 기울임
    //  — syncDosterPositions에서 매 프레임 lerp 적용
    // ═══════════════════════════════════════════
    var GAZE_DIST = 120;       // 시선 반응 범위 (px)
    var GAZE_MAX_ROT = 8;      // 최대 기울기 (deg)
    var GAZE_MAX_SHIFT = 2;    // 최대 수평 이동 (px)
    var GAZE_LERP = 0.10;      // 추적 부드러움 (0~1, 낮을수록 느긋)
    var GAZE_RETURN_LERP = 0.06; // 복귀 시 더 느긋하게

    function handleGlobalMouseMove(e) {
        if (!stage || !isActive) return;
        var stageRect = stage.getBoundingClientRect();
        // 스테이지 근처가 아니면 무시 (성능 최적화)
        if (e.clientY < stageRect.top - GAZE_DIST || e.clientY > stageRect.bottom + GAZE_DIST) {
            dosters.forEach(function(d) {
                d.gazeTargetRot = 0;
                d.gazeTargetX = 0;
            });
            return;
        }
        var mx = e.clientX - stageRect.left;
        var my = stageRect.bottom - e.clientY; // bottom 기준

        dosters.forEach(function(d) {
            if (!d.landed || d.fleeing || !d.el) {
                d.gazeTargetRot = 0;
                d.gazeTargetX = 0;
                return;
            }
            var elLeft = parseFloat(d.el.style.left) || 0;
            var elBottom = parseFloat(d.el.style.bottom) || 0;
            var size = DOSTER_SIZE[d.type] || DOSTER_SIZE[0];
            var cx = elLeft + size / 2;
            var cy = elBottom + size / 2;
            var dx = mx - cx;
            var dy = my - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < GAZE_DIST && dist > 1) {
                var intensity = 1 - (dist / GAZE_DIST);  // 0~1, 가까울수록 강함
                intensity = intensity * intensity;         // ease-in 곡선 (먼 거리는 미세, 가까우면 확실)
                var dirX = dx / dist;                      // 정규화된 방향 (-1 ~ 1)
                d.gazeTargetRot = dirX * intensity * GAZE_MAX_ROT;
                d.gazeTargetX = dirX * intensity * GAZE_MAX_SHIFT;
            } else {
                d.gazeTargetRot = 0;
                d.gazeTargetX = 0;
            }
        });
    }

    // ═══════════════════════════════════════════
    //  TOGGLE API
    // ═══════════════════════════════════════════
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

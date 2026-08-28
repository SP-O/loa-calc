import { json, SECURITY_HEADERS } from '../../lib/response.js';

// 경매 계산기 전용 시세 — 유물 각인서(거래소 40000) + 영웅 젬(아크 그리드 재료 230000)
const MARKET_URL = 'https://developer-lostark.game.onstove.com/markets/items';
const CAT_ENGRAVE = 40000;
const CAT_GEM = 230000;
const GEM_NAMES = [
    '질서의 젬 : 안정', '질서의 젬 : 견고', '질서의 젬 : 불변',
    '혼돈의 젬 : 침식', '혼돈의 젬 : 왜곡', '혼돈의 젬 : 붕괴'
];

const BLOCK_MS = 5 * 60 * 1000;
// ★ 서브리퀘스트는 요청당 50개가 한도다. 아래 페이지 상한 20 × 카테고리 2 = 40 이 최악값이다.
const MAX_PAGES = 20;

let cachedList = null;      // { items, lastUpdated }
let listFetchedAt = 0;
let inflightList = null;
const detailCache = new Map();

function listResponse() {
    const now = Date.now();
    const remaining = Math.max(1, Math.ceil(((Math.floor(now / BLOCK_MS) + 1) * BLOCK_MS - now) / 1000));
    return new Response(JSON.stringify(cachedList), {
        headers: {
            ...SECURITY_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${remaining}`,
            'x-cached-at': String(listFetchedAt)
        }
    });
}

export async function onRequest({ request, env, waitUntil }) {
    const API_KEY = env.LOSTARK_API_KEY_AUCTION;
    if (!API_KEY) return json({ error: '경매 API 키가 설정되지 않았습니다.' }, { status: 500 });

    const url = new URL(request.url);
    const itemId = url.searchParams.get('item');
    const cache = caches.default;

    try {
        if (itemId) return await handleDetail(API_KEY, String(itemId), url, cache, waitUntil);
        return await handleList(API_KEY, url, cache, waitUntil);
    } catch (e) {
        console.error('auction-market error:', e);
        if (!itemId && cachedList) return listResponse();
        return json({ error: '시세 데이터를 가져오는데 실패했습니다.' }, { status: 500 });
    }
}

async function handleList(API_KEY, url, cache, waitUntil) {
    const now = Date.now();
    const cacheKey = new Request(url.origin + '/api/auction-market', { method: 'GET' });
    const sameBlock = Math.floor(now / BLOCK_MS) === Math.floor(listFetchedAt / BLOCK_MS);

    if (cachedList && sameBlock) return listResponse();

    const hit = await cache.match(cacheKey);
    if (hit) {
        const at = Number(hit.headers.get('x-cached-at') || 0);
        if (Math.floor(at / BLOCK_MS) === Math.floor(now / BLOCK_MS)) return hit;
        waitUntil(refreshListThenPut(API_KEY, cache, cacheKey));
        return hit;
    }

    if (!inflightList) {
        inflightList = refreshList(API_KEY).finally(() => { inflightList = null; });
    }
    await inflightList;

    const res = listResponse();
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
}

async function refreshListThenPut(API_KEY, cache, cacheKey) {
    try {
        if (!inflightList) {
            inflightList = refreshList(API_KEY).finally(() => { inflightList = null; });
        }
        await inflightList;
        await cache.put(cacheKey, listResponse().clone());
    } catch (e) {
        console.error('경매 목록 백그라운드 갱신 실패:', e);
    }
}

async function refreshList(API_KEY) {
    const [engraves, gems] = await Promise.all([
        fetchCategory(API_KEY, CAT_ENGRAVE),
        fetchCategory(API_KEY, CAT_GEM)
    ]);
    const items = [];
    engraves.filter(i => i.Grade === '유물').forEach(i => items.push(mapItem(i, '각인서')));
    gems.filter(i => i.Grade === '영웅' && GEM_NAMES.includes(i.Name)).forEach(i => items.push(mapItem(i, '젬')));
    items.sort((a, b) => b.price - a.price);
    cachedList = { items, lastUpdated: Date.now() };
    listFetchedAt = Date.now();
}

function mapItem(i, category) {
    return {
        id: i.Id, name: i.Name, grade: i.Grade, category,
        price: i.CurrentMinPrice, ydayAvg: i.YDayAvgPrice, recent: i.RecentPrice, icon: i.Icon
    };
}

async function fetchCategory(API_KEY, categoryCode) {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const body = { Sort: 'CURRENT_MIN_PRICE', CategoryCode: categoryCode, PageNo: page, SortCondition: 'DESC' };
        const r = await fetch(MARKET_URL, {
            method: 'POST',
            headers: { accept: 'application/json', authorization: `bearer ${API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!r.ok) break;
        const data = await r.json();
        const items = data.Items || [];
        out.push(...items);
        const pageSize = data.PageSize || 10;
        if (items.length === 0 || page * pageSize >= (data.TotalCount || 0)) break;
    }
    return out;
}

async function handleDetail(API_KEY, id, url, cache, waitUntil) {
    const cached = detailCache.get(id);
    if (cached && (Date.now() - cached.at < BLOCK_MS)) {
        return json(cached.data, { cacheControl: 'public, max-age=300' });
    }

    const cacheKey = new Request(url.origin + '/api/auction-market?item=' + encodeURIComponent(id), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const r = await fetch(`${MARKET_URL}/${id}`, {
        headers: { accept: 'application/json', authorization: `bearer ${API_KEY}` }
    });
    if (!r.ok) return json({ error: '상세 시세 조회 실패' }, { status: 502 });

    const raw = await r.json();
    // 같은 이름의 아이템이 여러 개 온다. 거래 기록이 담긴 원소를 골라야 한다 —
    // 첫 원소만 보면 0으로만 채워진 더미를 읽는다.
    const list = Array.isArray(raw) ? raw : [raw];
    const picked = list.find(o => (o.Stats || []).some(s => s.AvgPrice > 0)) || list[0] || {};
    const statsData = picked.Stats || [];
    if (!Array.isArray(statsData) || statsData.length === 0) {
        return json({ history: [] }, { cacheControl: 'public, max-age=300' });
    }

    // 비교자 안에서 Date 를 만들면 비교마다 두 개씩 생긴다(365일치 21.78ms).
    // 한 번만 파싱해 숫자로 정렬한다 — 날짜 형식을 가정하지 않으면서 1.72ms
    const sorted = statsData.map(s => ({ s, t: Date.parse(s.Date) })).sort((a, b) => b.t - a.t).map(x => x.s);
    const history = sorted.slice(0, 14).map(s => {
        const d = new Date(s.Date);
        return {
            date: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
            avgPrice: Number(s.AvgPrice.toFixed(1)),
            volume: s.TradeCount
        };
    });
    const validPrices = history.map(h => h.avgPrice);
    const data = {
        todayAvg: history[0].avgPrice,
        avg14d: Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(1)),
        high14d: Math.max(...validPrices),
        low14d: Math.min(...validPrices),
        history
    };
    detailCache.set(id, { data, at: Date.now() });

    const res = new Response(JSON.stringify(data), {
        headers: {
            ...SECURITY_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=300'
        }
    });
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
}

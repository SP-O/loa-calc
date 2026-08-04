// 경매 계산기 전용 시세 — 유물 각인서(거래소 40000) + 영웅 젬(아크 그리드 재료 230000)
//  목록: GET /api/auction-market            → { items:[{id,name,grade,category,price,icon}], lastUpdated }
//  상세: GET /api/auction-market?item=<id>   → { todayAvg,avg14d,high14d,low14d,history:[{date,avgPrice,volume}] }
// 전용 키(process.env.LOSTARK_API_KEY_AUCTION, 분당 100회) 사용. market.js와 동일한 캐시 전략.

const MARKET_URL = 'https://developer-lostark.game.onstove.com/markets/items';
const CAT_ENGRAVE = 40000;   // 각인서
const CAT_GEM = 230000;      // 아크 그리드 재료(혼돈/질서의 젬)
const GEM_NAMES = [
    '질서의 젬 : 안정', '질서의 젬 : 견고', '질서의 젬 : 불변',
    '혼돈의 젬 : 침식', '혼돈의 젬 : 왜곡', '혼돈의 젬 : 붕괴'
];

// ---- 목록 캐시 (5분 블록, in-flight 공유) ----
let cachedList = null;      // { items, lastUpdated }
let listFetchedAt = 0;
let inflightList = null;
// ---- 상세 캐시 (아이템별 5분) ----
const detailCache = new Map(); // id -> { data, at }
const BLOCK_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
    const API_KEY = process.env.LOSTARK_API_KEY_AUCTION;
    if (!API_KEY) return res.status(500).json({ error: '경매 API 키가 설정되지 않았습니다.' });

    const itemId = req.query.item;
    try {
        if (itemId) return await handleDetail(res, API_KEY, String(itemId));
        return await handleList(res, API_KEY);
    } catch (e) {
        console.error('auction-market error:', e);
        if (!itemId && cachedList) return sendList(res); // 실패해도 이전 목록 유지
        return res.status(500).json({ error: '시세 데이터를 가져오는데 실패했습니다.' });
    }
}

// ===== 목록 =====
function sendList(res) {
    const remaining = Math.max(1, Math.ceil(((Math.floor(Date.now() / BLOCK_MS) + 1) * BLOCK_MS - Date.now()) / 1000));
    res.setHeader('Cache-Control', `public, s-maxage=${remaining}, stale-while-revalidate=600`);
    return res.status(200).json(cachedList);
}

async function handleList(res, API_KEY) {
    const now = Date.now();
    const sameBlock = Math.floor(now / BLOCK_MS) === Math.floor(listFetchedAt / BLOCK_MS);
    if (cachedList && sameBlock) return sendList(res);

    if (!inflightList) {
        inflightList = refreshList(API_KEY).finally(() => { inflightList = null; });
    }
    await inflightList;
    return sendList(res);
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

// 카테고리 전 페이지 조회(등급 필터는 호출측에서). PageSize 기준 마지막 페이지까지.
async function fetchCategory(API_KEY, categoryCode) {
    const out = [];
    for (let page = 1; page <= 20; page++) {
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

// ===== 상세(14일) =====
async function handleDetail(res, API_KEY, id) {
    const cached = detailCache.get(id);
    if (cached && (Date.now() - cached.at < BLOCK_MS)) {
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(cached.data);
    }
    const r = await fetch(`${MARKET_URL}/${id}`, {
        headers: { accept: 'application/json', authorization: `bearer ${API_KEY}` }
    });
    if (!r.ok) return res.status(502).json({ error: '상세 시세 조회 실패' });
    const raw = await r.json();
    // 같은 이름의 아이템이 여러 개 오는 경우가 있음(거래 이력이 없는 더미 포함).
    // 실제 거래 기록이 담긴 원소를 골라야 함 — 첫 원소만 보면 0으로만 채워진 더미를 읽게 됨.
    const list = Array.isArray(raw) ? raw : [raw];
    const picked = list.find(o => (o.Stats || []).some(s => s.AvgPrice > 0)) || list[0] || {};
    const statsData = picked.Stats || [];
    if (!Array.isArray(statsData) || statsData.length === 0) {
        return res.status(200).json({ history: [] });
    }
    const sorted = statsData.sort((a, b) => new Date(b.Date) - new Date(a.Date));
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
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
}

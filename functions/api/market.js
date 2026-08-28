import { json, SECURITY_HEADERS } from '../../lib/response.js';

// 1겹 — 모듈 캐시. Vercel 웜 람다보다 짧게 산다. 있으면 이득, 없으면 엣지 캐시로 간다.
let cachedData = null;      // { prices, stats, recents }
let lastFetchTime = 0;
let inflightRefresh = null;

// ★ Workers 무료 플랜은 요청당 서브리퀘스트 50개다.
//   1종이 시세+통계 2회를 쓰므로 22종 = 44회. 3종만 더 넣으면 한도를 넘어 갱신이 통째로 죽는다.
//   늘리려면 갱신을 여러 호출로 쪼개야 한다.
const ITEM_NAMES = [
    "아비도스 융화 재료", "상급 아비도스 융화 재료",
    "목재", "부드러운 목재", "아비도스 목재", "튼튼한 목재",
    "철광석", "묵직한 철광석", "아비도스 철광석", "단단한 철광석",
    "고대 유물", "희귀한 유물", "아비도스 유물",
    "생선", "붉은 살 생선", "아비도스 태양 잉어",
    "두툼한 생고기", "다듬은 생고기", "아비도스 두툼한 생고기",
    "들꽃", "수줍은 들꽃", "아비도스 들꽃"
];

const BLOCK_MS = 5 * 60 * 1000;
const delay = ms => new Promise(res => setTimeout(res, ms));
const sameBlock = (a, b) => Math.floor(a / BLOCK_MS) === Math.floor(b / BLOCK_MS);

function payload() {
    return {
        prices: cachedData.prices,
        stats: cachedData.stats,
        recents: cachedData.recents || {},
        lastUpdated: lastFetchTime
    };
}

function isEmpty() {
    return !cachedData || Object.keys(cachedData.prices || {}).length === 0;
}

// 엣지 캐시에 넣을 응답. Cache API 에는 SWR 이 없어 x-cached-at 으로 블록을 직접 판정한다.
function cacheableResponse(now) {
    const remaining = Math.max(1, Math.ceil(((Math.floor(now / BLOCK_MS) + 1) * BLOCK_MS - now) / 1000));
    return new Response(JSON.stringify(payload()), {
        headers: {
            ...SECURITY_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${remaining}`,
            'x-cached-at': String(lastFetchTime)
        }
    });
}

// 2겹 — 동시 요청이 몰려도 실제 갱신은 1회만
function shared(API_KEY) {
    if (!inflightRefresh) {
        inflightRefresh = refreshMarketData(API_KEY).finally(() => { inflightRefresh = null; });
    }
    return inflightRefresh;
}

export async function onRequest({ request, env, waitUntil }) {
    const url = new URL(request.url);
    const isForce = url.searchParams.get('force') === 'true';
    const now = Date.now();
    const cache = caches.default;
    // 쿼리를 뗀 고정 주소를 키로 쓴다. force 요청이 별도 캐시 항목을 만들지 않게.
    const cacheKey = new Request(url.origin + '/api/market', { method: 'GET' });
    const hasCache = cachedData && cachedData.prices;

    if (!isForce && hasCache && sameBlock(lastFetchTime, now)) return cacheableResponse(now);
    // 강제 갱신이라도 직전 갱신 60초 이내면 캐시를 준다 (로아 API 분당 100회 보호)
    if (isForce && hasCache && now - lastFetchTime < 60 * 1000) return json(payload());

    // 3겹 — isolate 가 새로 떠서 모듈 캐시가 비었을 때 여기서 걸린다
    if (!isForce) {
        const hit = await cache.match(cacheKey);
        if (hit) {
            const at = Number(hit.headers.get('x-cached-at') || 0);
            if (sameBlock(at, now)) return hit;
            // 블록이 지났다 — 낡은 값을 즉시 주고 뒤에서 갱신한다 (SWR 대체)
            waitUntil(refreshThenPut(env, cache, cacheKey));
            return hit;
        }
    }

    const API_KEY = isForce ? env.LOSTARK_API_KEY_MANUAL : env.LOSTARK_API_KEY_AUTO;
    if (!API_KEY) return json({ error: '서버에 API 키가 설정되지 않았습니다.' }, { status: 500 });

    try {
        await shared(API_KEY);
    } catch (error) {
        console.error('API Error:', error);
        // 갱신에 실패해도 이전 캐시가 있으면 그걸로 응답 (빈 화면 방지)
        if (!hasCache) return json({ error: '시세 데이터를 가져오는데 실패했습니다.' }, { status: 500 });
    }

    // 강제 갱신과 빈 결과는 엣지 캐시에 넣지 않는다 (Vercel 판의 no-store 와 같은 뜻)
    if (isForce || isEmpty()) return json(payload());

    const res = cacheableResponse(now);
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
}

// SWR 의 뒷단. 실패해도 조용히 넘어간다 — 이미 낡은 값으로 응답했다.
async function refreshThenPut(env, cache, cacheKey) {
    const API_KEY = env.LOSTARK_API_KEY_AUTO;
    if (!API_KEY) return;
    try {
        await shared(API_KEY);
        if (!isEmpty()) await cache.put(cacheKey, cacheableResponse(Date.now()).clone());
    } catch (error) {
        console.error('백그라운드 갱신 실패:', error);
    }
}

// 로아 API 에서 22종 시세+통계를 가져와 모듈 캐시를 갱신
async function refreshMarketData(API_KEY) {
    const results = [];
    const chunkSize = 5; // 동시 발신 연결은 요청당 6개가 한도다

    for (let i = 0; i < ITEM_NAMES.length; i += chunkSize) {
        const chunk = ITEM_NAMES.slice(i, i + chunkSize);
        const fetchPromises = chunk.map(async (itemName) => {
            try {
                const url = 'https://developer-lostark.game.onstove.com/markets/items';
                const categoryCode = itemName.includes("융화 재료") ? 50000 : 90000;
                const payload = {
                    Sort: "CURRENT_MIN_PRICE",
                    CategoryCode: categoryCode,
                    ItemTier: 0,
                    ItemName: itemName,
                    PageNo: 1,
                    SortCondition: "ASC"
                };

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'authorization': `bearer ${API_KEY}`,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) return { name: itemName, price: null, recent: null, stats: null };
                const data = await response.json();
                const exactItem = data.Items?.find(i => i.Name === itemName);
                if (!exactItem) return { name: itemName, price: null, recent: null, stats: null };

                let stats = null;
                const statsRes = await fetch(`https://developer-lostark.game.onstove.com/markets/items/${exactItem.Id}`, {
                    headers: { 'accept': 'application/json', 'authorization': `bearer ${API_KEY}` }
                });

                if (statsRes.ok) {
                    const rawData = await statsRes.json();
                    const statsData = rawData[0]?.Stats || [];
                    if (Array.isArray(statsData) && statsData.length > 0) {
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
                        stats = {
                            todayAvg: history[0].avgPrice,
                            avg14d: Number((validPrices.reduce((a, b) => a + b, 0) / validPrices.length).toFixed(1)),
                            high14d: Math.max(...validPrices),
                            low14d: Math.min(...validPrices),
                            history: history
                        };
                    }
                }

                return { name: itemName, price: exactItem.CurrentMinPrice, recent: exactItem.RecentPrice || null, stats };
            } catch (e) {
                return { name: itemName, price: null, recent: null, stats: null };
            }
        });

        const chunkResults = await Promise.all(fetchPromises);
        results.push(...chunkResults);

        if (i + chunkSize < ITEM_NAMES.length) await delay(200);
    }

    // 실패한 아이템은 이전 캐시값을 유지한다
    const newPrices = cachedData?.prices ? { ...cachedData.prices } : {};
    const newStats = cachedData?.stats ? { ...cachedData.stats } : {};
    const newRecents = cachedData?.recents ? { ...cachedData.recents } : {};

    results.forEach(item => {
        if (item.price !== null && item.price > 0) newPrices[item.name] = item.price;
        if (item.recent !== null && item.recent > 0) newRecents[item.name] = item.recent;
        if (item.stats !== null) newStats[item.name] = item.stats;
    });

    cachedData = { prices: newPrices, stats: newStats, recents: newRecents };
    lastFetchTime = Date.now();
}

// Vercel 서버가 떠있는 동안 메모리에 유지될 캐시 변수들
let cachedData = null; // { prices: {}, stats: {} } 형태로 저장
let lastFetchTime = 0;

// 검색할 아이템 22종
const ITEM_NAMES = [
    "아비도스 융화 재료", "상급 아비도스 융화 재료",
    "목재", "부드러운 목재", "아비도스 목재", "튼튼한 목재",
    "철광석", "묵직한 철광석", "아비도스 철광석", "단단한 철광석",
    "고대 유물", "희귀한 유물", "아비도스 유물",
    "생선", "붉은 살 생선", "아비도스 태양 잉어",
    "두툼한 생고기", "다듬은 생고기", "아비도스 두툼한 생고기",
    "들꽃", "수줍은 들꽃", "아비도스 들꽃"
];

const delay = ms => new Promise(res => setTimeout(res, ms));

export default async function handler(req, res) {
    const isForceRefresh = req.query.force === 'true';
    const now = Date.now();
    const currentBlock = Math.floor(now / (5 * 60 * 1000));
    const cachedBlock = Math.floor(lastFetchTime / (5 * 60 * 1000));

    // 캐시 반환 로직: 강제 갱신이 아니고, 캐시가 있고, 같은 5분 블록이면 캐시 반환
    if (!isForceRefresh && cachedData && cachedData.prices && (currentBlock === cachedBlock)) {
        return res.status(200).json({
            prices: cachedData.prices,
            stats: cachedData.stats,
            lastUpdated: lastFetchTime 
        });
    }

    // 강제 갱신은 MANUAL 키, 자동 갱신은 AUTO 키 사용 (Vercel 환경변수에 설정)
    const API_KEY = isForceRefresh 
        ? process.env.LOSTARK_API_KEY_MANUAL 
        : process.env.LOSTARK_API_KEY_AUTO;

    if (!API_KEY) {
        return res.status(500).json({ error: "Vercel 서버에 API 키가 설정되지 않았습니다." });
    }

    try {
        const results = [];
        const chunkSize = 5; // 5개씩 병렬 조회하여 429 에러 및 타임아웃 방지

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
                    
                    if (!response.ok) return { name: itemName, price: null, stats: null };
                    const data = await response.json();
                    const exactItem = data.Items?.find(i => i.Name === itemName);
                    if (!exactItem) return { name: itemName, price: null, stats: null };

                    // 단가 확보 후 해당 아이템의 14일치 시세(stats) 추가 조회
                    let stats = null;
                    const statsRes = await fetch(`https://developer-lostark.game.onstove.com/markets/items/${exactItem.Id}`, {
                        headers: { 
                            'accept': 'application/json', 
                            'authorization': `bearer ${API_KEY}` 
                        }
                    });

                    if (statsRes.ok) {
                        const rawData = await statsRes.json();
                        const statsData = rawData[0]?.Stats || [];
                        if (Array.isArray(statsData) && statsData.length > 0) {
                            const sorted = statsData.sort((a, b) => new Date(b.Date) - new Date(a.Date));
                            const history = sorted.slice(0, 14).map(s => {
                                const d = new Date(s.Date);
                                return { 
                                    // MM.DD 형식으로 포맷
                                    date: `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, 
                                    avgPrice: Math.round(s.AvgPrice), 
                                    volume: s.TradeCount 
                                };
                            });
                            const validPrices = history.map(h => h.avgPrice);
                            stats = {
                                todayAvg: history[0].avgPrice,
                                avg14d: Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length),
                                high14d: Math.max(...validPrices),
                                low14d: Math.min(...validPrices),
                                history: history
                            };
                        }
                    }

                    return { name: itemName, price: exactItem.CurrentMinPrice, stats };
                } catch (e) {
                    return { name: itemName, price: null, stats: null };
                }
            });

            const chunkResults = await Promise.all(fetchPromises);
            results.push(...chunkResults);
            
            // API 과부하 방지를 위한 지연 (마지막 청크 제외)
            if (i + chunkSize < ITEM_NAMES.length) await delay(200); 
        }

        // 기존 캐시 복사 및 병합 (실패한 아이템은 이전 캐시값 유지)
        const newPrices = cachedData?.prices ? { ...cachedData.prices } : {};
        const newStats = cachedData?.stats ? { ...cachedData.stats } : {};

        results.forEach(item => {
            if (item.price !== null && item.price > 0) newPrices[item.name] = item.price;
            if (item.stats !== null) newStats[item.name] = item.stats;
        });

        cachedData = { prices: newPrices, stats: newStats };
        lastFetchTime = Date.now();

        return res.status(200).json({
            prices: cachedData.prices,
            stats: cachedData.stats,
            lastUpdated: lastFetchTime
        });
        
    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: "시세 데이터를 가져오는데 실패했습니다." });
    }
}

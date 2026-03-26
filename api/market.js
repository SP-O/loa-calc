// Vercel 서버가 떠있는 동안 메모리에 유지될 캐시 변수들
let cachedData = null;
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

export default async function handler(req, res) {
    // 프론트에서 ?force=true 로 요청하면 강제 새로고침으로 간주
    const isForceRefresh = req.query.force === 'true';
    const now = Date.now();
    
    // 현재 시간을 5분(300,000ms) 단위의 고정 블록으로 계산 (예: 45분~49분은 같은 블록)
    const currentBlock = Math.floor(now / (5 * 60 * 1000));
    const cachedBlock = Math.floor(lastFetchTime / (5 * 60 * 1000));

    // 1. 강제 새로고침이 아니고, 동일한 5분 정각 구간 내에 있다면 캐시 반환
    if (!isForceRefresh && cachedData && (currentBlock === cachedBlock)) {
        return res.status(200).json({
            prices: cachedData,
            lastUpdated: lastFetchTime 
        });
    }

    // 2. 용도에 맞는 API 키 선택 (Vercel 환경변수에서 가져옴)
    const API_KEY = isForceRefresh 
        ? process.env.LOSTARK_API_KEY_MANUAL // 수동 갱신용 키
        : process.env.LOSTARK_API_KEY_AUTO;  // 5분 자동 갱신용 키

    if (!API_KEY) {
        return res.status(500).json({ error: "Vercel 서버에 API 키가 설정되지 않았습니다." });
    }

    try {
        // 2. Vercel 환경에서 동시 호출로 인한 로스트아크 API Rate Limit (429 에러) 방지용 청크 분할 및 지연 처리
        const delay = ms => new Promise(res => setTimeout(res, ms));
        const results = [];
        const chunkSize = 4; // 한 번에 4개씩 병렬 조회
        
        for (let i = 0; i < ITEM_NAMES.length; i += chunkSize) {
            const chunk = ITEM_NAMES.slice(i, i + chunkSize);
            const fetchPromises = chunk.map(async (itemName) => {
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

                let stats = null;
                try {
                    const statsRes = await fetch(`https://developer-lostark.game.onstove.com/markets/items/${exactItem.Id}`, {
                        headers: { 'accept': 'application/json', 'authorization': `bearer ${API_KEY}` }
                    });
                    
                    if (statsRes.ok) {
                        const statsData = await statsRes.json();
                        if (Array.isArray(statsData) && statsData.length > 0) {
                            const sorted = statsData.sort((a, b) => new Date(b.Date) - new Date(a.Date));
                            const history = sorted.slice(0, 14).map(s => {
                                const d = new Date(s.Date);
                                return { 
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
                } catch (e) {
                    console.error(`Stats fetch error for ${itemName}:`, e);
                }

                return { name: itemName, price: exactItem.CurrentMinPrice, stats };
            });

            const chunkResults = await Promise.all(fetchPromises);
            results.push(...chunkResults);
            
            // 마지막 청크가 아니면 API 과부하를 피하기 위해 250ms 대기
            if (i + chunkSize < ITEM_NAMES.length) {
                await delay(250); 
            }
        }
        
        // 기존 캐시를 복사한 뒤, 정상 응답만 덮어쓰기
        const newPrices = cachedData?.prices ? { ...cachedData.prices } : {};
        const newStats = cachedData?.stats ? { ...cachedData.stats } : {};
        
        results.forEach(item => {
            if (item.price !== null && item.price > 0) {
                newPrices[item.name] = item.price;
            }
            if (item.stats) {
                newStats[item.name] = item.stats;
            }
        });

        // 5. 서버 캐시 및 시간 업데이트
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

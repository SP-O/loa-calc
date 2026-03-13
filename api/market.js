// api/market.js

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
    const CACHE_DURATION = 5 * 60 * 1000; // 5분 (밀리초)

    // 1. 강제 새로고침이 아니고, 5분이 지나지 않았다면 캐시된 데이터 반환
    if (!isForceRefresh && cachedData && (now - lastFetchTime < CACHE_DURATION)) {
        return res.status(200).json({
            prices: cachedData,
            lastUpdated: lastFetchTime // 캐시가 갱신되었던 시간
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
        // 3. 22개 아이템 시세 병렬로 한 번에 조회
        const fetchPromises = ITEM_NAMES.map(async (itemName) => {
            const url = 'https://developer-lostark.game.onstove.com/markets/items';
            const payload = {
                Sort: "CURRENT_MIN_PRICE",
                CategoryCode: 50000,
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
            
            if (!response.ok) return { name: itemName, price: 0 };
            const data = await response.json();
            
            // 정확한 아이템 이름 매칭
            const exactItem = data.Items?.find(i => i.Name === itemName);
            return { name: itemName, price: exactItem ? exactItem.CurrentMinPrice : 0 };
        });

        const results = await Promise.all(fetchPromises);
        
        // 4. 결과를 { "목재": 5, "철광석": 4 ... } 형태로 포맷팅
        const newPrices = {};
        results.forEach(item => {
            newPrices[item.name] = item.price;
        });

        // 5. 서버 캐시 및 시간 업데이트
        cachedData = newPrices;
        lastFetchTime = Date.now();

        return res.status(200).json({
            prices: cachedData,
            lastUpdated: lastFetchTime
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ error: "시세 데이터를 가져오는데 실패했습니다." });
    }
}
 

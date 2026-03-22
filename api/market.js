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

// 대기 함수 추가
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
    const isForceRefresh = req.query.force === 'true';
    const now = Date.now();
    
    const currentBlock = Math.floor(now / (5 * 60 * 1000));
    const cachedBlock = Math.floor(lastFetchTime / (5 * 60 * 1000));

    // 1. 캐시 반환 로직 (동일)
    if (!isForceRefresh && cachedData && (currentBlock === cachedBlock)) {
        return res.status(200).json({
            prices: cachedData,
            lastUpdated: lastFetchTime 
        });
    }

    const API_KEY = isForceRefresh 
        ? process.env.LOSTARK_API_KEY_MANUAL 
        : process.env.LOSTARK_API_KEY_AUTO; 

    if (!API_KEY) {
        return res.status(500).json({ error: "Vercel 서버에 API 키가 설정되지 않았습니다." });
    }

    try {
        const newPrices = {};
        const url = 'https://developer-lostark.game.onstove.com/markets/items';

        // 3. 순차적으로 하나씩 조회 (핵심 수정 사항)
        for (const itemName of ITEM_NAMES) {
            const categoryCode = itemName.includes("융화 재료") ? 50000 : 90000;
            
            const payload = {
                Sort: "CURRENT_MIN_PRICE",
                CategoryCode: categoryCode,
                ItemName: itemName,
                PageNo: 1,
                SortCondition: "ASC"
            };

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'accept': 'application/json',
                        'authorization': `bearer ${API_KEY}`,
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    const data = await response.json();
                    const exactItem = data.Items?.find(i => i.Name === itemName);
                    newPrices[itemName] = exactItem ? exactItem.CurrentMinPrice : (cachedData?.[itemName] || 0);
                } else {
                    // API 호출 실패 시 기존 캐시값이 있으면 유지 (0원 방지)
                    newPrices[itemName] = cachedData?.[itemName] || 0;
                }
            } catch (e) {
                newPrices[itemName] = cachedData?.[itemName] || 0;
            }

            // 요청 사이에 0.15초 휴식 (초당 제한 및 동시 요청 차단 방지)
            await sleep(150); 
        }

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

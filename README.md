# 로아도쓰 (LoaDoss)

로스트아크 유저들을 위한 계산 웹사이트입니다.
현재 아비도스 제작 및 효율 계산, 경매 입찰 계산기, 티카투카 계산기(티파고)가 구현되어 있습니다.
로아도쓰만의 독창적인 기능을 구현하려 하며, 유저들의 편의성을 위한 개발을 진행합니다.

**https://loadoss.com**

2026년 3월 시작 · 운영 중

---

## 도구

### 아비도스 융화 재료 제작 계산기 — [`/`](https://loadoss.com/)

생활 재료로 아비도스 융화 재료를 만들 때의 손익을 계산합니다.

- **재료 교환 계산** — 보유 재료로 만들 수 있는 최대 횟수와 그때의 교환 경로. 기본/영지 농장 두 모드
- **목표 제작 계산** — 원하는 제작 횟수에 필요한 재료를 역산
- **제작 수익** — 실시간 시세 기반 손익. 판매 수수료 5%, 영지 제작 수수료, 대성공 확률 반영
- **제작 랭킹** — 벌목·채광·고고학·낚시·수렵·채집 여섯 생활의 손익 순위
- **시세 차트** — 재료별 14일 평균 거래가·거래량

### 경매 입찰 계산기 — [`/auction`](https://loadoss.com/auction)

레이드 전리품 경매에서 얼마까지 입찰해야 이득인지 계산합니다.
손익 분기점 · 추천 입찰가 · 최대 이득가 · 싸게 노리기 네 가지 값을 제시하고,
각 금액에서 상회 입찰당했을 때 분배금이 어떻게 달라지는지 함께 보여줍니다.

입력한 금액과 시세가 비슷한 아이템의 14일 거래 차트를 자동으로 띄웁니다.
경매 보상으로 나오는 유물 각인서 전 종류와 영웅 등급 젬을 지원합니다.

### 티파고 — 티카투카 계산기 — [`/tikatuka`](https://loadoss.com/tikatuka)

로스트아크의 주사위 미니게임 티카투카에서 이길 확률이 가장 높은 수를 추천합니다.

- **완전탐색 + 몬테카를로** — 남은 경우의 수가 적으면 완전탐색, 많으면 롤아웃
- **화면 인식** — 게임 화면을 공유하면 보드와 굴린 주사위를 자동으로 읽습니다
- **오버레이** — Document Picture-in-Picture로 게임 위에 추천을 띄웁니다
- **리롤 판단** — 지금 굴린 주사위를 쓸지 다시 굴릴지 승률로 비교

---

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 프론트엔드 | Vue 3 (전역 빌드), Chart.js, 순수 ES 모듈 |
| 티파고 엔진 | Web Worker 3종 (완전탐색 · 몬테카를로 풀 · 화면 인식) |
| 화면 인식 | `getDisplayMedia`, Canvas, 템플릿 매칭 |
| 오버레이 | Document Picture-in-Picture API |
| 서버 | Vercel Serverless Functions (운영) · Cloudflare Pages Functions (이전 준비 완료) |
| 데이터 | 로스트아크 Open API |
| 그 외 | Firebase Realtime Database · Matter.js (이스터에그), GTM / GA4 |
| 테스트 | Node.js 내장 테스트 러너 |

---

## 프로젝트 구조

```
├── index.html              아비도스 제작 계산기 (Vue 앱)
├── auction.html            경매 입찰 계산기 페이지
├── tikatuka.html           티파고 페이지
├── news.html               업데이트 내역
├── guide/                  이용 가이드 6개
├── contact · terms · privacy · 404
│
├── tools/
│   ├── auction/            경매 계산 로직(calc.js)과 화면(app.js)
│   └── tikatuka/
│       ├── app.js          티파고 UI
│       └── src/
│           ├── solver/     완전탐색 · 몬테카를로 · 평가함수 · 조언
│           ├── vision/     화면 캡처 · 캘리브레이션 · 템플릿 매칭
│           ├── rules.js    티카투카 규칙(알까기 · 보너스 · 밑장)
│           └── overlay.js  Document PiP 오버레이
│
├── api/                    Vercel 서버리스 (시세 · 경매 시세 · Firebase 설정)
├── functions/api/          Cloudflare Pages Functions (같은 역할, 이전용)
├── assets/                 공용 CSS/JS, 이스터에그, 벤더 라이브러리
└── test/                   회귀 테스트
```

---

## 면책

본 사이트는 Smilegate RPG 및 Smilegate Stove의 공식 서비스가 아니며 무관합니다.
제공되는 데이터는 로스트아크 Open API를 기반으로 가공한 정보입니다.
로스트아크와 관련된 자산의 권리는 Smilegate RPG에 있습니다.

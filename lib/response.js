// _headers 는 Pages Functions 응답에 적용되지 않는다. 함수 쪽 응답 헤더는 여기서 붙인다.
// X-Robots-Tag 는 보안 헤더가 아니지만, 모든 API 응답이 이 객체를 펼쳐 쓰므로 여기 둔다.
// /api/* 는 JSON 이라 색인 대상이 아닌데 구글이 크롤해 「크롤링됨 - 색인 생성 안 됨」으로
// 계속 보고했다(서치콘솔 2026-09). robots.txt 로 막으면 noindex 를 볼 기회조차 없어져
// 상태가 더 오래 남는다. 크롤은 허용하되 색인하지 말라고 알려 주는 쪽이 맞다.
export const SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex'
};

export function json(body, { status = 200, cacheControl = 'no-store' } = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...SECURITY_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'Cache-Control': cacheControl
        }
    });
}

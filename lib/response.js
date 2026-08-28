// _headers 는 Pages Functions 응답에 적용되지 않는다. 함수 쪽 보안 헤더는 여기서 붙인다.
export const SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
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

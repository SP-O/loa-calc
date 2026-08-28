import { json } from '../../lib/response.js';

export async function onRequest({ env }) {
    const config = {
        apiKey:            env.FIREBASE_API_KEY,
        authDomain:        env.FIREBASE_AUTH_DOMAIN,
        databaseURL:       env.FIREBASE_DATABASE_URL,
        projectId:         env.FIREBASE_PROJECT_ID,
        storageBucket:     env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
        appId:             env.FIREBASE_APP_ID
    };

    if (!config.apiKey || !config.databaseURL) {
        return json({ error: 'Firebase 설정이 서버에 구성되지 않았습니다.' }, { status: 500 });
    }
    return json(config, { cacheControl: 'private, max-age=300' });
}

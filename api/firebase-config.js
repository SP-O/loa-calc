export default async function handler(req, res) {
    const config = {
        apiKey:            process.env.FIREBASE_API_KEY,
        authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL:       process.env.FIREBASE_DATABASE_URL,
        projectId:         process.env.FIREBASE_PROJECT_ID,
        storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId:             process.env.FIREBASE_APP_ID,
    };

    if (!config.apiKey || !config.databaseURL) {
        return res.status(500).json({ error: 'Firebase 설정이 서버에 구성되지 않았습니다.' });
    }

    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json(config);
}

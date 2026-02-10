// status can be "online", "idle", "dnd", or "invisible" or "offline"
export default [
    {
        channelId: "1344059457747026005",
        serverId: "1344059457046319198",
        token: process.env.token1,
        selfDeaf: false,
        autoReconnect: {
            enabled: true,
            delay: 5, // ثواني
            maxRetries: 5,
        },
        presence: {
            status: "idle",
        },
        selfMute: true,
        // إعدادات الستريم الجديد
        stream: {
            enabled: true, // تفعيل فتح الاستريم
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // رابط الفيديو للبث (اختياري)
            type: "screen", // "screen" أو "youtube" أو "video"
            title: "24/7 Live Stream", // عنوان البث
            resolution: "1920x1080" // دقة البث
        }
    },
];
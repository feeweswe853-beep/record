// status can be "online", "idle", "dnd", or "invisible" or "offline"
export default [
    {
        channelId: "1459504963402076180",
        serverId: "534163543516250114",
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
    },
    
        {
        channelId: "1459504963402076180",
        serverId: "534163543516250114",
        token: process.env.token2,
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
    },
];
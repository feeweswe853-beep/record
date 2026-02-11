// status can be "online", "idle", "dnd", or "invisible" or "offline"
export default [
    {
        channelId: "1471265162055913626", //hazem
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
        selfMute: false,
    },
    
        {
        channelId: "1471265162055913626",
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
        selfMute: false,
    },

           {
        channelId: "1471265162055913626",
        serverId: "534163543516250114",
        token: process.env.token3,
        selfDeaf: false,
        autoReconnect: {
            enabled: true,
            delay: 5, // ثواني
            maxRetries: 5,
        },
        presence: {
            status: "dnd",
        },
        selfMute: true,
    }, 

               {
        channelId: "1471270870000603280",
        serverId: "534163543516250114",
        token: process.env.token4,
        selfDeaf: false,
        autoReconnect: {
            enabled: true,
            delay: 5, // ثواني
            maxRetries: 5,
        },
        presence: {
            status: "dnd",
        },
        selfMute: true,
    }, 
]; 
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import prism from 'prism-media';
const blackListedEvents = ["CHANNEL_UNREAD_UPDATE", "CONVERSATION_SUMMARY_UPDATE", "SESSIONS_REPLACE"];
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const statusList = ["online", "idle", "dnd", "invisible", "offline"];
const VOICE_GATEWAY_VERSION = 4;

export class voiceClient extends EventEmitter {
    ws = null;
    voiceWebSocket = null;
    heartbeatInterval;
    voiceHeartbeatInterval;
    sequenceNumber = null;
    firstLoad = true;
    reconnectAttempts = 0;
    ignoreReconnect = false;
    reconnectTimeout;
    invalidSession = false;
    token;
    guildId;
    channelId;
    selfMute;
    selfDeaf;
    autoReconnect;
    presence;
    stream;
    user_id = null;
    session_id = null;
    voiceSessionId = null;
    voiceToken = null;
    voiceEndpoint = null;
    voiceServer = null;
    voiceChannel = null;
    voiceConnection = null;
    streamAudio = null;
    isStreaming = false;

    constructor(config) {
        super();
        if (!config.token) {
            throw new Error('token, guildId, and channelId are required');
        }
        this.token = config.token;
        this.guildId = config?.serverId;
        this.channelId = config?.channelId;
        this.selfMute = config.selfMute ?? true;
        this.selfDeaf = config.selfDeaf ?? true;
        this.autoReconnect = {
            enabled: config.autoReconnect.enabled ?? false,
            delay: (config.autoReconnect.delay ?? 1) * 1000,
            maxRetries: config.autoReconnect?.maxRetries ?? 9999,
        };
        if (config?.presence?.status) {
            this.presence = config.presence;
        }
        // إعدادات الستريم
        this.stream = config.stream || {
            enabled: false,
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            type: "screen",
            title: "24/7 Live Stream",
            resolution: "1920x1080"
        };
    }

    connect() {
        if (this.invalidSession) return;
        this.ws = new WebSocket(GATEWAY_URL, {
            skipUTF8Validation: true,
        });
        this.setMaxListeners(5);
        
        this.ws.on('open', () => {
            this.emit('connected');
            this.emit('debug', '🌐 Connected to Discord Gateway');
        });

        this.ws.on('message', (data) => {
            const payload = JSON.parse(data.toString());
            const { t: eventType, s: seq, op, d } = payload;
            const isBlackListed = blackListedEvents.includes(eventType);
            
            if (isBlackListed) return;
            
            if (seq !== null) this.sequenceNumber = seq;

            switch (op) {
                case 10: // Hello
                    this.emit('debug', 'Received Hello (op 10)');
                    this.startHeartbeat(d.heartbeat_interval);
                    this.identify();
                    break;
                    
                case 11: // Heartbeat ACK
                    this.emit('debug', 'Heartbeat acknowledged');
                    break;
                    
                case 9: // Invalid Session
                    this.emit('debug', 'Invalid session. Reconnecting...');
                    this.invalidSession = true;
                    if (this.ws) {
                        this.ws.terminate();
                    }
                    this.cleanup();
                    break;
                    
                case 0: // Dispatch
                    this.handleDispatch(eventType, d);
                    break;
            }
        });

        this.ws.on('close', () => {
            this.emit('disconnected');
            this.emit('debug', '❌ Disconnected. Reconnecting...');
            this.cleanup();
            
            if (this.firstLoad) {
                console.log(`Bad token or invalid channelId/guildId`);
                return;
            }
            
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (err) => {
            this.emit('error', err);
            this.emit('debug', `WebSocket error: ${err.message}`);
        });
    }

    handleDispatch(eventType, d) {
        switch (eventType) {
            case 'READY':
                this.emit('ready', {
                    username: d.user.username,
                    discriminator: d.user.discriminator
                });
                this.emit('debug', `🎉 Logged in as ${d.user.username}#${d.user.discriminator}`);
                this.user_id = d.user.id;
                this.session_id = d.session_id;
                this.joinVoiceChannel();
                this.sendStatusUpdate();
                break;
                
            case 'VOICE_STATE_UPDATE':
                this.handleVoiceStateUpdate(d);
                break;
                
            case 'VOICE_SERVER_UPDATE':
                this.handleVoiceServerUpdate(d);
                break;
        }
    }

    handleVoiceStateUpdate(d) {
        if (d.user_id === this.user_id && d.channel_id === this.channelId && d?.guild_id === this.guildId && this.firstLoad) {
            this.emit('voiceReady');
            console.log('Voice channel joined successfully');
            this.emit('debug', 'Successfully joined voice channel');
            this.firstLoad = false;
            
            // إذا كان الستريم مفعل، ابدأ البث
            if (this.stream.enabled) {
                setTimeout(() => {
                    this.startStream();
                }, 2000);
            }
            
        } else if (d.user_id === this.user_id && (this.guildId && this.channelId && d?.channel_id !== this.channelId || d?.guild_id !== this.guildId)) {
            this.handleReconnection();
        }
    }

    handleVoiceServerUpdate(d) {
        this.voiceToken = d.token;
        this.voiceEndpoint = d.endpoint;
        this.voiceServer = d;
        
        if (this.session_id && this.voiceToken && this.voiceEndpoint) {
            this.connectToVoice();
        }
    }

    handleReconnection() {
        if (this.autoReconnect.enabled) {
            console.log('Received VOICE_STATE_UPDATE event, attempting to reconnect');
            if (this.ignoreReconnect) {
                console.log('Already reconnected, ignoring this event');
                return;
            }
            
            this.reconnectAttempts++;
            if (this.reconnectAttempts < this.autoReconnect.maxRetries) {
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                this.emit('debug', `Reconnecting... (${this.reconnectAttempts}/${this.autoReconnect.maxRetries})`);
                this.ignoreReconnect = true;
                this.reconnectTimeout = setTimeout(() => {
                    this.joinVoiceChannel();
                }, this.autoReconnect.delay);
            } else {
                this.emit('debug', 'Max reconnect attempts reached. Stopping.');
                this.cleanup();
            }
        }
    }

    startHeartbeat(interval) {
        this.heartbeatInterval = setInterval(() => {
            this.ws?.send(JSON.stringify({ op: 1, d: this.sequenceNumber }));
            this.emit('debug', 'Sending heartbeat');
        }, interval);
    }

    identify() {
        const payload = {
            op: 2,
            d: {
                token: this.token,
                intents: (1 << 7) | (1 << 31), // Voice States + GUILD_VOICE_STATES
                properties: {
                    os: 'Windows',
                    browser: 'Chrome',
                    device: ''
                },
            }
        };
        this.ws?.send(JSON.stringify(payload));
        this.emit('debug', 'Sending identify payload');
    }

    joinVoiceChannel() {
        if (!this.guildId || !this.channelId) return;
        
        const voiceStateUpdate = {
            op: 4,
            d: {
                guild_id: this.guildId,
                channel_id: this.channelId,
                self_mute: this.selfMute,
                self_deaf: this.selfDeaf
            }
        };
        
        this.ws?.send(JSON.stringify(voiceStateUpdate));
        this.emit('debug', '🎤 Sent voice channel join request');
        
        setTimeout(() => {
            this.ignoreReconnect = false;
        }, 1000);
    }

    connectToVoice() {
        if (!this.voiceEndpoint || !this.voiceToken || !this.session_id || !this.guildId || !this.user_id) {
            this.emit('debug', 'Missing voice connection parameters');
            return;
        }

        const voiceGatewayURL = `wss://${this.voiceEndpoint.split('//')[1]}?v=${VOICE_GATEWAY_VERSION}`;
        
        this.voiceWebSocket = new WebSocket(voiceGatewayURL, {
            skipUTF8Validation: true,
        });

        this.voiceWebSocket.on('open', () => {
            this.emit('debug', 'Connected to Voice Gateway');
            
            const identifyPayload = {
                op: 0,
                d: {
                    server_id: this.guildId,
                    user_id: this.user_id,
                    session_id: this.session_id,
                    token: this.voiceToken,
                }
            };
            
            this.voiceWebSocket.send(JSON.stringify(identifyPayload));
            this.emit('debug', 'Sent voice identify');
        });

        this.voiceWebSocket.on('message', (data) => {
            const payload = JSON.parse(data.toString());
            this.emit('debug', `Voice: ${JSON.stringify(payload)}`);
            
            switch (payload.op) {
                case 2: // Ready
                    this.voiceSessionId = payload.d.ssrc;
                    this.emit('debug', 'Voice ready, starting heartbeat');
                    this.startVoiceHeartbeat(payload.d.heartbeat_interval);
                    break;
                    
                case 4: // Session Description
                    this.emit('debug', 'Voice session description received');
                    break;
                    
                case 6: // Heartbeat ACK
                    this.emit('debug', 'Voice heartbeat ACK');
                    break;
            }
        });

        this.voiceWebSocket.on('close', () => {
            this.emit('debug', 'Voice WebSocket closed');
            if (this.voiceHeartbeatInterval) {
                clearInterval(this.voiceHeartbeatInterval);
            }
        });

        this.voiceWebSocket.on('error', (err) => {
            this.emit('error', err);
            this.emit('debug', `Voice WebSocket error: ${err.message}`);
        });
    }

    startVoiceHeartbeat(interval) {
        this.voiceHeartbeatInterval = setInterval(() => {
            if (this.voiceWebSocket && this.voiceWebSocket.readyState === WebSocket.OPEN) {
                this.voiceWebSocket.send(JSON.stringify({ op: 3, d: Date.now() }));
                this.emit('debug', 'Sent voice heartbeat');
            }
        }, interval);
    }

    async startStream() {
        if (!this.stream.enabled || this.isStreaming) return;
        
        this.emit('debug', 'Starting live stream...');
        this.isStreaming = true;
        
        try {
            // هنا يمكنك إضافة منطق لبدء البث الفعلي
            // هذا مثال مبسط لإرسال بيانات صوتية
            this.streamAudio = this.createAudioStream();
            
            this.emit('streamStarted', {
                title: this.stream.title,
                type: this.stream.type,
                resolution: this.stream.resolution,
                url: this.stream.url
            });
            
            this.emit('debug', `🎥 Live stream started: ${this.stream.title}`);
            console.log(`🎥 Live stream started for ${this.stream.title}`);
            
        } catch (error) {
            this.emit('error', error);
            this.emit('debug', `Failed to start stream: ${error.message}`);
            this.isStreaming = false;
        }
    }

    createAudioStream() {
        // هذا مثال لإنشاء دفق صوتي افتراضي
        // في الإنتاج الحقيقي، ستحتاج إلى دفق فيديو/صوتي حقيقي
        const encoder = new prism.opus.Encoder({
            rate: 48000,
            channels: 2,
            frameSize: 960
        });
        
        // محاكاة إرسال بيانات صوتية صامتة
        const sendSilence = () => {
            if (this.isStreaming && this.voiceWebSocket && this.voiceWebSocket.readyState === WebSocket.OPEN) {
                // إرسال حزمة صوتية صامتة
                const silentPacket = Buffer.alloc(127);
                this.voiceWebSocket.send(silentPacket);
            }
        };
        
        // إرسال بيانات كل 20ms (معدل إطار Opus)
        const interval = setInterval(sendSilence, 20);
        
        return {
            stop: () => {
                clearInterval(interval);
                encoder.destroy();
            }
        };
    }

    stopStream() {
        if (this.isStreaming && this.streamAudio) {
            this.streamAudio.stop();
            this.isStreaming = false;
            this.emit('streamStopped');
            this.emit('debug', 'Live stream stopped');
        }
    }

    cleanup() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.voiceHeartbeatInterval) clearInterval(this.voiceHeartbeatInterval);
        if (this.voiceWebSocket) {
            this.voiceWebSocket.close();
            this.voiceWebSocket = null;
        }
        this.stopStream();
        this.ws = null;
        this.sequenceNumber = null;
        this.voiceSessionId = null;
        this.voiceToken = null;
        this.voiceEndpoint = null;
        this.session_id = null;
    }

    sendStatusUpdate() {
        const status = this?.presence?.status?.toLowerCase();
        if (!status || !statusList.includes(status)) return;
        
        const payload = {
            "op": 3,
            "d": {
                status: this.presence.status,
                activities: [{
                    name: this.stream.enabled ? this.stream.title : "Idle",
                    type: this.stream.enabled ? 1 : 0, // 1 = Streaming
                    url: this.stream.enabled ? this.stream.url : null,
                    details: this.stream.enabled ? `Live ${this.stream.type}` : null,
                    state: this.stream.enabled ? this.stream.resolution : null,
                    timestamps: {
                        start: this.stream.enabled ? Date.now() : null
                    },
                    assets: {
                        large_image: this.stream.enabled ? "streaming" : null,
                        large_text: this.stream.enabled ? this.stream.title : null
                    }
                }],
                since: Math.floor(Date.now() / 1000) - 10,
                afk: true
            }
        };
        
        this.ws?.send(JSON.stringify(payload));
        this.emit('debug', `Status updated to ${this.presence.status} with streaming activity`);
    }

    disconnect() {
        this.cleanup();
        this.emit('debug', 'Client manually disconnected');
    }
}
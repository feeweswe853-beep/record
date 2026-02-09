const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Routes, PermissionsBitField, ChannelType } = require('discord.js');
const { JoinVoiceChannel, joinVoiceChannel } = require('@discordjs/voice');
const { REST } = require('@discordjs/rest');
const Recorder = require('./recorder');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('Set BOT_TOKEN environment variable (Railway: add as env var)');
  process.exit(1);
}

// libsodium is required by @discordjs/voice for encryption modes (voice encryption)
const sodium = require('libsodium-wrappers');


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}'); } catch (e) { config = {}; }

function saveConfig() { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); }

const sessions = new Map(); // guildId -> session info

client.once('ready', async () => {
  console.log('Bot ready:', client.user.tag);

  // Register commands (global; takes time) — simple set for convenience
  const commands = [
    {
      name: 'voice',
      description: 'Set voice channel to monitor',
      options: [{ name: 'channel', description: 'Voice channel', type: 7, required: true }],
    },
    {
      name: 'channel',
      description: 'Set text channel to send recordings',
      options: [{ name: 'channel', description: 'Text channel', type: 7, required: true }],
    },
    {
      name: 'role',
      description: 'Set admin role for fake-deafen commands',
      options: [{ name: 'role', description: 'Role', type: 8, required: true }],
    },
    {
      name: 'fake_deafen',
      description: 'Toggle fake deafen (admin only)',
    }
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Registered application commands (global).');
  } catch (err) {
    console.warn('Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply({ content: 'Commands must be used in a server.', ephemeral: true });

  if (!config[guildId]) config[guildId] = {};

  if (commandName === 'voice') {
    const channel = interaction.options.getChannel('channel');
    if (channel.type !== ChannelType.GuildVoice) return interaction.reply({ content: 'Please provide a voice channel.', ephemeral: true });
    config[guildId].voiceChannelId = channel.id;
    saveConfig();
    // join immediately
    try { await joinAndPrepare(guildId, channel.id); } catch (e) { console.error(e); }
    return interaction.reply({ content: `Voice channel set to ${channel.name}`, ephemeral: false });
  }

  if (commandName === 'channel') {
    const channel = interaction.options.getChannel('channel');
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return interaction.reply({ content: 'Please provide a text channel.', ephemeral: true });
    config[guildId].textChannelId = channel.id; saveConfig();
    return interaction.reply({ content: `Text channel set to ${channel.name}`, ephemeral: false });
  }

  if (commandName === 'role') {
    const role = interaction.options.getRole('role');
    config[guildId].adminRoleId = role.id; saveConfig();
    return interaction.reply({ content: `Admin role set to ${role.name}`, ephemeral: false });
  }

  if (commandName === 'fake_deafen') {
    const adminRoleId = config[guildId] && config[guildId].adminRoleId;
    if (!adminRoleId) return interaction.reply({ content: 'Admin role not set.', ephemeral: true });
    if (!interaction.member.roles.cache.has(adminRoleId)) return interaction.reply({ content: 'You are not an admin.', ephemeral: true });
    // toggle: disconnect and rejoin with opposite selfDeaf
    const s = sessions.get(guildId);
    if (!s || !s.connection) return interaction.reply({ content: 'Bot is not joined to a monitored voice channel.', ephemeral: true });
    const current = s.selfDeaf ?? true;
    const newSelfDeaf = !current;
    try {
      await s.connection.destroy();
    } catch (e) {}
    // rejoin with new selfDeaf
    try { await joinAndPrepare(guildId, config[guildId].voiceChannelId, newSelfDeaf); } catch (e) { console.error(e); }
    return interaction.reply({ content: `Toggled fake deafen to ${newSelfDeaf}`, ephemeral: false });
  }
});

async function joinAndPrepare(guildId, voiceChannelId, selfDeaf = true) {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(voiceChannelId);
  if (!channel) throw new Error('Voice channel not found');
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf,
  });

  // prepare session
  const textChannel = config[guildId] && config[guildId].textChannelId ? await guild.channels.fetch(config[guildId].textChannelId) : null;
  const sessionId = `${guildId}-${Date.now()}`;
  const recorder = new Recorder(connection, textChannel, sessionId);
  recorder.startListening();

  // track participants
  const voiceChannel = channel;

  // store
  sessions.set(guildId, {
    connection,
    recorder,
    voiceChannelId: voiceChannel.id,
    selfDeaf,
    sessionId,
    timer30: null,
    locked: false,
  });

  connection.receiver.speaking.on('end', (userId) => {
    // handled by recorder inner cleanup
  });

  console.log(`Joined and prepared recording for guild ${guildId}`);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = oldState.guild.id;
  const s = sessions.get(guildId);
  if (!s) return;
  const voiceChannel = await oldState.guild.channels.fetch(s.voiceChannelId).catch(() => null);
  if (!voiceChannel) return;

  // If someone undeafened in that voice channel -> start recording
  const concerned = [oldState, newState];
  if ((oldState.channelId === s.voiceChannelId || newState.channelId === s.voiceChannelId)) {
    const becameUndeaf = (oldState.selfDeaf && !newState.selfDeaf) || (oldState.serverDeaf && !newState.serverDeaf);
    const joined = (!oldState.channelId && newState.channelId === s.voiceChannelId);
    const left = (oldState.channelId === s.voiceChannelId && newState.channelId !== s.voiceChannelId);

    // start recording on undeaf or join (if not deaf)
    if (becameUndeaf || (joined && !newState.selfDeaf && !newState.serverDeaf)) {
      startSessionRecording(guildId);
    }

    // handle leaving -> if last person left stop and send
    const members = voiceChannel.members;
    // exclude the bot
    const humanMembers = members.filter(m => !m.user.bot);
    if (humanMembers.size === 0) {
      // stop after 0ms -> immediate stop and then lock channel 3s
      stopSessionRecordingAndSend(guildId);
    }
  }
});

function startSessionRecording(guildId) {
  const s = sessions.get(guildId);
  if (!s) return;
  if (s.recording) return; // already recording
  s.recording = true;
  s.recorderFiles = [];
  s.startTime = Date.now();
  // start 30-minute timer
  s.timer30 = setTimeout(async () => {
    // flush current recordings and continue new
    await s.recorder.stopAll();
    await s.recorder.sendFiles();
    // reset
    s.recorder = new (require('./recorder'))(s.connection, s.recorder.textChannel, `${guildId}-${Date.now()}`);
    s.recorder.startListening();
    startSessionRecording(guildId); // restart timer
  }, 30 * 60 * 1000);
  console.log('Started recording session for', guildId);
}

async function stopSessionRecordingAndSend(guildId) {
  const s = sessions.get(guildId);
  if (!s || !s.recording) return;
  s.recording = false;
  if (s.timer30) { clearTimeout(s.timer30); s.timer30 = null; }
  try { s.recorder.stopAll(); } catch (e) {}
  // lock channel for 3 seconds
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(s.voiceChannelId);
    if (channel && !s.locked) {
      s.locked = true;
      await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
      setTimeout(async () => {
        try { await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: null }); } catch (e) {}
        s.locked = false;
      }, 3000);
    }
  } catch (e) { console.warn('Failed to lock/unlock channel', e); }

  // send files
  try {
    await s.recorder.sendFiles();
  } catch (e) { console.error('Error sending recordings', e); }
}

// Wait for libsodium to be ready before logging in so voice encryption works
sodium.ready.then(() => {
  console.log('libsodium ready — logging in');
  client.login(TOKEN);
}).catch((err) => {
  console.error('Failed to initialize libsodium:', err);
  process.exit(1);
});

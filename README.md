# Discord Voice Recorder Bot

This project implements a Discord bot that can join a specified voice channel, record participants' audio into WAV files, and send recorded files to a configured text channel.

Features implemented:
- Slash commands: `/voice` (set voice channel), `/channel` (set text channel), `/role` (set admin role), `/fake_deafen` (toggle fake deafen for bot by admin)
- Joins the specified voice channel and self-deafens.
- Starts recording when someone undeafens or joins un-deafened.
- Records per-user WAV files and sends them to the configured text channel after the session.
- When the last human leaves, bot locks the voice channel for 3 seconds to avoid rapid rejoin noise, then unlocks.
- If a recording reaches 30 minutes, the bot sends the current files and starts a new recording.

Requirements
- Node.js >= 18
- ffmpeg installed on host for more advanced processing (not strictly required for per-user WAV files)

Environment
- `BOT_TOKEN` — your bot token (set in Railway as an environment variable)

Install and run locally
```bash
npm install
export BOT_TOKEN=your_token_here
node index.js
```

Railway deployment
- Add `BOT_TOKEN` as an environment variable in Railway.
- Make sure to install the packages by running `npm install` in Railway build step.
- Ensure the Railway environment has `ffmpeg` available; if not, enable it or modify recordings flow accordingly.

Quick Docker / Railway tips
- This repo includes a `Dockerfile` that installs `ffmpeg` and runs `node index.js`.
- Use the `Procfile` (process type `worker`) so Railway runs the bot without requiring an HTTP port.
- In Railway add an Environment Variable named `BOT_TOKEN` with your bot token.
- If you prefer not to use Docker, ensure `ffmpeg` is available in the Railway service and `npm install` runs during build.

Local run
```bash
cd /workspaces/record
npm install
export BOT_TOKEN=your_bot_token_here
node index.js
```

Notes
- If Railway's build fails due to native modules, try building with Docker using the included `Dockerfile`.
- Logs and permissions: give the bot `CONNECT`, `SPEAK`, `MANAGE_CHANNELS`, and `Send Messages` in the guild and text channel.

Notes & Permissions
- Bot needs `CONNECT`, `SPEAK`, `MANAGE_CHANNELS` (for temporarily editing channel permissions), and `Send Messages` in the configured text channel.
- This implementation records per-user WAV files rather than mixing into a single stereo file.
# record
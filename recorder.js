const fs = require('fs');
const path = require('path');
const prism = require('prism-media');
const wav = require('wav');
const { EndBehaviorType } = require('@discordjs/voice');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class Recorder {
  constructor(connection, textChannel, sessionId) {
    this.connection = connection;
    this.receiver = connection.receiver;
    this.textChannel = textChannel;
    this.sessionId = sessionId;
    this.outDir = path.resolve(process.cwd(), 'recordings', sessionId);
    ensureDir(this.outDir);
    this.userStreams = new Map();
    this.files = [];
  }

  startListening() {
    this.receiver.speaking.on('start', (userId) => {
      if (this.userStreams.has(userId)) return;
      const opusStream = this.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 100,
        },
      });

      const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000,
      });

      const filePath = path.join(this.outDir, `${userId}.wav`);
      const wavWriter = new wav.FileWriter(filePath, {
        sampleRate: 48000,
        channels: 2,
      });

      opusStream.pipe(decoder).pipe(wavWriter);

      const cleanup = () => {
        try { opusStream.destroy(); } catch (e) {}
        try { decoder.end(); } catch (e) {}
        try { wavWriter.end(); } catch (e) {}
        this.userStreams.delete(userId);
        this.files.push(filePath);
      };

      opusStream.on('end', cleanup);
      opusStream.on('close', cleanup);
      opusStream.on('error', cleanup);

      this.userStreams.set(userId, { opusStream, decoder, wavWriter, filePath });
    });
  }

  stopAll() {
    for (const [userId, s] of this.userStreams.entries()) {
      try { s.opusStream.destroy(); } catch (e) {}
      try { s.decoder.end(); } catch (e) {}
      try { s.wavWriter.end(); } catch (e) {}
      this.files.push(s.filePath);
    }
    this.userStreams.clear();
  }

  async sendFiles() {
    if (!this.textChannel) return;
    if (this.files.length === 0) {
      await this.textChannel.send('No audio was recorded in this session.');
      return;
    }

    try {
      for (const f of this.files) {
        const name = path.basename(f);
        await this.textChannel.send({ files: [{ attachment: f, name }] });
      }
    } catch (err) {
      console.error('Failed to send files:', err);
    }
  }
}

module.exports = Recorder;

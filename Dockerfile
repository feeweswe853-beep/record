FROM node:18-slim

# Install ffmpeg and libsodium system library for voice encryption
RUN apt-get update && apt-get install -y ffmpeg ca-certificates libsodium-dev --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first to leverage Docker layer cache
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund || true

COPY . .

CMD ["node", "index.js"]

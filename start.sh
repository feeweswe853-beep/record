#!/bin/sh
if [ -z "$BOT_TOKEN" ]; then
  echo "Error: BOT_TOKEN not set. Set BOT_TOKEN environment variable and retry."
  exit 1
fi

node index.js

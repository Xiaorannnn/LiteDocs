FROM node:20-bookworm-slim
# Build tools are only a fallback in case a prebuilt better-sqlite3 binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/app.db
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server/index.js"]

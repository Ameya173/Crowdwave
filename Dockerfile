# --- build the PWA ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY client/package*.json client/
RUN cd client && npm install
COPY client client
RUN cd client && npm run build

# --- run the Campus Node (serves API, WebSocket signaling and the built PWA) ---
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm install --omit=dev
COPY server server
COPY --from=build /app/client/dist client/dist
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data TRUST_PROXY=1
VOLUME /data
EXPOSE 8787
CMD ["node", "server/src/index.js"]

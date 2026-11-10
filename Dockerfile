FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs game.mjs store.mjs pg-store.mjs ./
COPY migrations ./migrations
COPY public ./public
COPY scripts ./scripts
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]

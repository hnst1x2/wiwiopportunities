FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install production deps from the lockfile for reproducible builds.
COPY package*.json ./
RUN npm ci --omit=dev

# App code (data JSON files are bundled as first-boot seeds; runtime data lives in DATA_DIR).
COPY server ./server
COPY public ./public
COPY views ./views

# In production, DATA_DIR should point at a mounted volume (see docker-compose.prod.yml).
# The SQLite store lives at $DATA_DIR/wiwiopportunity.db.
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# --experimental-sqlite: enables Node's built-in node:sqlite module (required on Node 22).
CMD ["node", "--experimental-sqlite", "server/app.js"]

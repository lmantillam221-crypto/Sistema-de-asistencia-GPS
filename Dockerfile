# Nube.chic · Asistencia v2
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/asistencia.db
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/salud || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]

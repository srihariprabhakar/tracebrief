FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/var/lib/tracebrief

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY demo ./demo

RUN mkdir -p /var/lib/tracebrief && chown -R node:node /app /var/lib/tracebrief
USER node

EXPOSE 8787
VOLUME ["/var/lib/tracebrief"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "server/index.mjs"]

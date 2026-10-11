# GrantKosh: one small container serving the UI, the data and the Gemini advisor API.
# Build:  docker build -t grantkosh .
# Run:    docker run -p 8080:8080 -e GEMINI_API_KEY=... grantkosh
# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
# Install with only the manifests first so dependency layers cache across source edits.
COPY package.json package-lock.json ./
COPY scraper/package.json scraper/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:prod

# Runtime: the server is a self-contained bundle, so no node_modules are shipped.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    GRANTKOSH_DATA_DIR=/app/web/dist/data/
WORKDIR /app
COPY --from=build --chown=node:node /app/agent/dist/server.mjs agent/dist/server.mjs
COPY --from=build --chown=node:node /app/web/dist web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "agent/dist/server.mjs"]

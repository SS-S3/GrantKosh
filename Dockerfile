# GrantKosh: one small container serving the UI, the data and the Gemini advisor API.
# Build:  docker build -t grantkosh .
# Run:    docker run -p 8080:8080 -e GEMINI_API_KEY=... grantkosh
# syntax=docker/dockerfile:1

# The build output is plain JS and static files, so build once on the native platform
# and copy it into each target architecture (amd64 and arm64 for Oracle Ampere).
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
# Install with only the manifests first so dependency layers cache across source edits.
COPY package.json package-lock.json ./
COPY scraper/package.json scraper/
COPY web/package.json web/
COPY agent/package.json agent/
RUN npm ci --no-audit --no-fund
COPY . .
# Clerk's publishable key is baked into the UI at build time (it is public, not a secret).
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build:prod

# Runtime: the server is a self-contained bundle, so no node_modules are shipped.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    GRANTKOSH_DATA_DIR=/app/web/dist-data/
WORKDIR /app
COPY --from=build --chown=node:node /app/agent/dist/server.mjs agent/dist/server.mjs
COPY --from=build --chown=node:node /app/web/dist web/dist
# The data files sit outside the served folder; the API reads them and returns one page at a time.
COPY --from=build --chown=node:node /app/web/dist-data web/dist-data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "agent/dist/server.mjs"]

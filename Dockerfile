# Single-stage image for the PageBolt MCP server.
#
# Consumed directly by Glama's builder — keep this SINGLE-STAGE on node:*-slim.
# Without a Dockerfile, Glama falls back to an auto-generated debian:bookworm-slim
# base that often fails with "context deadline exceeded" when resolving Docker Hub
# metadata. Pure JS (no compile step), so one stage is enough.
FROM node:20-slim

LABEL org.opencontainers.image.source="https://github.com/Custodia-Admin/pagebolt-mcp"
LABEL org.opencontainers.image.description="MCP server for PageBolt — screenshots, PDFs, OG images, page inspection, narrated video"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY README.md LICENSE server.json ./

# Built-in non-root user from the official Node image.
USER node

# MCP speaks JSON-RPC over stdio. PAGEBOLT_API_KEY must be provided at runtime
# (e.g. docker run -e PAGEBOLT_API_KEY=... or via Glama env config).
ENTRYPOINT ["node", "src/index.mjs"]

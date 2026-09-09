# syntax=docker/dockerfile:1.7

# O projeto possui dependências que já exigem Node 22. Instalar node/npm pelo
# apt sobre python:3 trazia Node 18 e centenas de pacotes Debian desnecessários.
FROM node:22-bookworm-slim AS node-base

FROM node-base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --prefer-offline --no-audit --no-fund

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM dependencies AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN --mount=type=secret,id=env_local,dst=/app/.env.local \
    --mount=type=cache,target=/app/.next/cache,sharing=locked \
    npm run build

FROM node-base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Poppler rasteriza PDFs. OpenCV headless e NumPy executam o OMR PTR1 sem
# depender de pacotes instalados diretamente no Ubuntu hospedeiro.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl poppler-utils python3 python3-venv tini \
  && rm -rf /var/lib/apt/lists/*
COPY services/omr/requirements.txt /tmp/omr-requirements.txt
RUN python3 -m venv /opt/omr
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
  /opt/omr/bin/pip install -r /tmp/omr-requirements.txt \
  && rm /tmp/omr-requirements.txt

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/services ./services
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]

# ── Stage 1 : Build ───────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

# Configuration de build Angular : production | preprod | development.
# Passée par le pipeline via `docker build --build-arg env=preprod`.
ARG env=production

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration=$env

# ── Stage 2 : Run ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/VolleyTeamOptimizer ./dist/VolleyTeamOptimizer

EXPOSE 4000

CMD ["node", "dist/VolleyTeamOptimizer/server/server.mjs"]

# ── Stage 1 : Build ───────────────────────────────────────────────────────────
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2 : Run ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/VolleyTeamOptimizer ./dist/VolleyTeamOptimizer

EXPOSE 4000

CMD ["node", "dist/VolleyTeamOptimizer/server/server.mjs"]

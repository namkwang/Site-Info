# syntax=docker/dockerfile:1.7
# Next.js 16 standalone build — 3-stage to keep the final image lean.

# ── Stage 1: install deps (cached unless package*.json changes) ────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build with NEXT_PUBLIC_* baked in ─────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env (baked into the JS bundle the browser downloads).
# CI passes these via --build-arg from GitHub Actions secrets.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG NEXT_PUBLIC_KAKAO_JS_KEY=""
ARG NEXT_PUBLIC_API_BASE=""
# 우리 테이블이 사는 스키마. 비우면 코드 기본값(pmis). 팀 프로젝트는 site_info.
ARG NEXT_PUBLIC_DB_SCHEMA=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_KAKAO_JS_KEY=$NEXT_PUBLIC_KAKAO_JS_KEY \
    NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_DB_SCHEMA=$NEXT_PUBLIC_DB_SCHEMA \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: runtime — only what's needed to run `node server.js` ──────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

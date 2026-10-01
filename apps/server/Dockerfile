FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY apps/server/package.json ./apps/server/

RUN bun install --frozen-lockfile

COPY packages/core ./packages/core
COPY apps/server ./apps/server

FROM oven/bun:1.2-alpine AS runner

WORKDIR /app

COPY --from=builder /app ./

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["bun", "run", "apps/server/src/index.ts"]

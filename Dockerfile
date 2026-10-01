FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/

RUN bun install --frozen-lockfile

COPY packages/core ./packages/core
COPY apps/web ./apps/web

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN bun run --filter @zerotracker/web build

FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

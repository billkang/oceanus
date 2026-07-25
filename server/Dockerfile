FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/
COPY server/prisma server/prisma/
RUN pnpm install --frozen-lockfile
COPY server/ server/
RUN pnpm --filter @oceanus/server prisma:generate
RUN pnpm --filter @oceanus/server build

FROM node:24-alpine AS production
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/v1/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]

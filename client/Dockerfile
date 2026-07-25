FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json client/
RUN pnpm install --frozen-lockfile
COPY client/ client/
RUN pnpm --filter @oceanus/client build

FROM nginx:stable-alpine
COPY --from=build /app/client/build/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

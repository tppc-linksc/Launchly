FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api/package.json services/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY cli/package.json cli/package.json

RUN pnpm install --frozen-lockfile

COPY services/api services/api
COPY apps/web apps/web

WORKDIR /app/services/api
RUN pnpm prisma:generate
RUN pnpm build

FROM moby/buildkit:v0.16.0-rootless AS buildkit

WORKDIR /app/apps/web
RUN pnpm build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/services/api/node_modules /app/services/api/node_modules
COPY --from=builder /app/services/api/dist /app/services/api/dist
COPY --from=builder /app/apps/web/dist /app/services/api/dist/web
COPY --from=builder /app/services/api/prisma /app/services/api/prisma
COPY --from=builder /app/services/api/package.json /app/services/api/package.json
COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl
COPY services/api/docker-entrypoint.sh /app/services/api/docker-entrypoint.sh

RUN apt-get update && apt-get install -y --no-install-recommends curl git openssh-client && rm -rf /var/lib/apt/lists/* \
  && chmod 0555 /app/services/api/docker-entrypoint.sh \
  && useradd --system --uid 10001 --create-home launchly

WORKDIR /app/services/api
USER launchly
EXPOSE 8080
ENTRYPOINT ["/app/services/api/docker-entrypoint.sh"]

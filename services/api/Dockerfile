FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/api/package.json services/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY cli/package.json cli/package.json

RUN pnpm install --frozen-lockfile

COPY services/api services/api

WORKDIR /app/services/api
RUN pnpm prisma:generate
RUN pnpm build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/services/api/node_modules /app/services/api/node_modules
COPY --from=builder /app/services/api/dist /app/services/api/dist
COPY --from=builder /app/services/api/prisma /app/services/api/prisma
COPY --from=builder /app/services/api/package.json /app/services/api/package.json

RUN apt-get update && apt-get install -y docker.io curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app/services/api
EXPOSE 8080
CMD ["node", "dist/main"]

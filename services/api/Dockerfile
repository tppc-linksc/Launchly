FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY services/api/package*.json ./
COPY services/api/prisma ./prisma/
RUN npm ci

COPY services/api/ .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

# Install docker CLI for docker compose commands
RUN apt-get update && apt-get install -y docker.io curl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/main"]

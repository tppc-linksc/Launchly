# Node 22+ required for pnpm 11 (Corepack); pnpm 11 uses node:sqlite built-in.
FROM node:22-alpine AS web-build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm --filter @launchly/web build

FROM maven:3.9-eclipse-temurin-17 AS api-build
WORKDIR /src
COPY services/api/pom.xml services/api/pom.xml
RUN mvn -f services/api/pom.xml -q -DskipTests dependency:go-offline
COPY services/api services/api
COPY --from=web-build /src/apps/web/dist services/api/src/main/resources/static
RUN mvn -f services/api/pom.xml -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY --from=api-build /src/services/api/target/*.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]

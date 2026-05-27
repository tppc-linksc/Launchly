FROM maven:3.9-eclipse-temurin-17 AS worker-build
WORKDIR /src
COPY services/worker/pom.xml services/worker/pom.xml
RUN mvn -f services/worker/pom.xml -q -DskipTests dependency:go-offline
COPY services/worker services/worker
RUN mvn -f services/worker/pom.xml -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine
RUN apk add --no-cache docker-cli docker-cli-compose git curl
WORKDIR /app
COPY --from=worker-build /src/services/worker/target/*.jar /app/worker.jar
ENTRYPOINT ["java", "-jar", "/app/worker.jar"]

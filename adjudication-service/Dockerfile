# ---- build ----------------------------------------------------------------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# couche de dépendances (cache tant que pom.xml ne change pas)
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q clean package -DskipTests

# ---- run -----------------------------------------------------------------
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# utilisateur non-root
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /build/target/adjudication-service-*.jar /app/app.jar
USER app

EXPOSE 8081

# variables requises au runtime (aucune valeur par défaut sensible) :
#   JDBC_URL, JDBC_USER (=svc_adjudication), JDBC_PASSWORD, SERVICE_JWT_SECRET
ENV JAVA_OPTS=""

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8081/healthz || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]

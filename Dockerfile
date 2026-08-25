# ─── Сборка ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS build

# Prisma и sharp нужны системные библиотеки OpenSSL
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Слой зависимостей кэшируется отдельно от кода
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Оставляем только продовые зависимости, но клиент Prisma сохраняем
RUN pnpm prune --prod && pnpm exec prisma generate

# ─── Рантайм ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# Railway подставляет PORT сам
ENV HOST=0.0.0.0
EXPOSE 3000

USER node

# Миграции применяются на старте — новый деплой сам приводит схему в порядок
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/src/server.js"]

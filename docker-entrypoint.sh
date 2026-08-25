#!/bin/sh
set -e

# Проверяем обязательные переменные до запуска Prisma.
# Иначе контейнер падает на миграции и вываливает стену wasm-ошибок,
# по которой не видно, что на самом деле не заполнено окружение.

missing=""
for name in DATABASE_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET APP_URL CORS_ORIGIN; do
  eval "value=\$$name"
  [ -z "$value" ] && missing="$missing $name"
done

if [ -n "$missing" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo " ZAGATOVKY API не может стартовать: не заданы переменные"
  echo "═══════════════════════════════════════════════════════════════"
  for name in $missing; do echo "  ✗ $name"; done
  echo ""
  echo " Задайте их в настройках сервиса (Railway → сервис api → Variables)."
  echo ""
  echo " DATABASE_URL на Railway указывается ссылкой на базу:"
  echo "   DATABASE_URL=\${{Postgres.DATABASE_URL}}"
  echo " где Postgres — имя вашего сервиса с базой ровно как в интерфейсе."
  echo " Если сервис называется иначе, подставьте его имя."
  echo ""
  echo " Полный список — в README.md репозитория."
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  exit 1
fi

echo "→ Применяю миграции базы данных"
node node_modules/prisma/build/index.js migrate deploy

echo "→ Запускаю API"
exec node dist/src/server.js

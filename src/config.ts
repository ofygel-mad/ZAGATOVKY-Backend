import 'dotenv/config';
import { z } from 'zod';

/**
 * Список origin'ов через запятую.
 *
 * Значение приходит из панели хостинга, где легко занести лишнее: кавычки,
 * экранирование, слэш или целый путь вроде /login. Браузер же присылает
 * в Origin только схему и хост, поэтому приводим каждый элемент именно к нему —
 * иначе сравнение молча не совпадёт и запросы будут блокироваться без внятной причины.
 */
const originList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim().replace(/^["'\\]+|["'\\]+$/g, ''))
    .filter(Boolean)
    .map((item) => {
      try {
        return new URL(item).origin;
      } catch {
        return item.replace(/\/+$/, '');
      }
    })
    .filter(Boolean),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_URL: z.string().url(),
  CORS_ORIGIN: originList,

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET должен быть не короче 16 символов'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET должен быть не короче 16 символов'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  SEED_OWNER_EMAIL: z.string().email().default('owner@zagatovky.kz'),
  SEED_OWNER_PASSWORD: z.string().min(8).default('zagatovky123'),

  R2_ACCOUNT_ID: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_PUBLIC_URL: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Падаем громко и понятно, а не стартуем с половиной настроек.
  console.error(`\nНекорректная конфигурация окружения:\n${issues}\n\nСверьтесь с backend/.env.example\n`);
  process.exit(1);
}

const env = parsed.data;

/**
 * Загрузка фото включается только когда заполнены все реквизиты R2.
 * До этого API работает полностью, просто без приёма файлов.
 */
const storageEnabled =
  Boolean(env.R2_ACCOUNT_ID) &&
  Boolean(env.R2_BUCKET) &&
  Boolean(env.R2_ACCESS_KEY_ID) &&
  Boolean(env.R2_SECRET_ACCESS_KEY) &&
  Boolean(env.R2_PUBLIC_URL);

// Частая путаница: в R2_PUBLIC_URL подставляют S3-эндпоинт, по которому файлы
// отдаются только с подписью запроса. Загрузка при этом проходит успешно,
// а у посетителей картинки молча не открываются — поэтому предупреждаем громко.
if (env.R2_PUBLIC_URL.includes('r2.cloudflarestorage.com')) {
  console.error(
    [
      '',
      '═══════════════════════════════════════════════════════════════',
      ' R2_PUBLIC_URL указывает на S3-эндпоинт, а не на публичный домен',
      '═══════════════════════════════════════════════════════════════',
      ` Сейчас: ${env.R2_PUBLIC_URL}`,
      '',
      ' По этому адресу файлы отдаются только с подписью запроса — у',
      ' посетителей витрины фотографии не откроются.',
      '',
      ' Нужен публичный домен бакета: Cloudflare → R2 → ваш бакет →',
      ' Settings → Public access. Это адрес вида https://pub-<хеш>.r2.dev',
      ' либо подключённый вами собственный домен.',
      '═══════════════════════════════════════════════════════════════',
      '',
    ].join('\n'),
  );
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  apiPrefix: '/api/v1',
  storage: {
    enabled: storageEnabled,
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicUrl: env.R2_PUBLIC_URL.replace(/\/$/, ''),
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  },
} as const;

export type Config = typeof config;

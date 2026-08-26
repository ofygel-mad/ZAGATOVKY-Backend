import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { authPlugin } from './plugins/auth.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { homeRoutes } from './modules/home/home.routes.js';
import { orderRoutes } from './modules/orders/orders.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { adminProductRoutes } from './modules/admin/products.routes.js';
import { adminContentRoutes } from './modules/admin/content.routes.js';
import { adminOrderRoutes } from './modules/admin/orders.routes.js';
import { adminSystemRoutes } from './modules/admin/system.routes.js';
import { adminFinanceRoutes } from './modules/admin/finance.routes.js';
import { feedbackRoutes } from './modules/feedback/feedback.routes.js';
import { adminFeedbackRoutes } from './modules/admin/feedback.routes.js';

export const buildApp = async () => {
  const app = Fastify({
    logger: config.isDevelopment
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false });

  // Чужой origin отвергается молча: браузер показывает ошибку, а в логах сервера
  // пусто — по такой картине причину не найти. Поэтому каждый новый отвергнутый
  // домен логируем один раз, сразу с подсказкой, что дописать в CORS_ORIGIN.
  const rejectedOrigins = new Set<string>();

  await app.register(cors, {
    origin: (origin, callback) => {
      // Запросы без Origin (curl, healthcheck, серверные) пропускаем.
      if (!origin) return callback(null, true);

      const normalized = origin.replace(/\/$/, '');
      const allowed = config.CORS_ORIGIN.includes(normalized);

      if (!allowed && !rejectedOrigins.has(normalized)) {
        rejectedOrigins.add(normalized);
        app.log.warn(
          `CORS: домен ${normalized} не разрешён. Добавьте его в переменную CORS_ORIGIN ` +
            `(сейчас разрешены: ${config.CORS_ORIGIN.join(', ') || 'ничего'}).`,
        );
      }

      callback(null, allowed);
    },
    credentials: true,
  });

  await app.register(cookie, { secret: config.JWT_REFRESH_SECRET });

  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    // Штатный ответ плагина — английский «Rate limit exceeded, retry in …»
    // с кодом INTERNAL_ERROR. Его видел покупатель на странице оформления,
    // хотя ничего не сломалось: он просто слишком часто нажимал.
    // context.after — тоже английский («10 minutes»), поэтому считаем сами.
    errorResponseBuilder: (_request, context) => {
      const minutes = Math.max(1, Math.ceil(Number(context.ttl ?? 0) / 60_000));
      const word = minutes === 1 ? 'минуту' : minutes < 5 ? 'минуты' : 'минут';
      return {
        statusCode: 429,
        error: 'RATE_LIMITED',
        // Ответ плагина проходит через общий setErrorHandler, а тот берёт код из
        // поля `code`. Без него в теле оказывался INTERNAL_ERROR — будто сервер
        // сломался, хотя человек просто слишком часто нажимал.
        code: 'RATE_LIMITED',
        message: `Слишком много попыток. Подождите ${minutes} ${word} и попробуйте ещё раз.`,
      };
    },
  });

  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });

  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ZAGATOVKY API',
        description: 'Витрина кулинарных заготовок и админ-кабинет',
        version: '1.0.0',
      },
      servers: [{ url: config.isProduction ? '/' : `http://localhost:${config.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // Схему генерируем всегда (по ней собираются типы клиентов), а вот открытый
  // просмотрщик в проде публиковал всю карту API кому угодно без авторизации.
  if (!config.isProduction) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }

    /*
     * Fastify не пробрасывает ZodError наружу: валидатор возвращает готовый
     * массив в error.validation, где у каждой записи лежит зодовское сообщение
     * и путь до поля. Раньше разбиралась только ветка с настоящим ZodError, а
     * реальные запросы шли по второй — и все написанные тексты («Укажите телефон
     * полностью», «Старая цена должна быть выше текущей») подменялись общим
     * «Проверьте заполненные поля». Человек видел отказ и не понимал, где ошибся.
     */
    const fastifyIssues = (
      error as { validation?: { instancePath?: string; message?: string }[] }
    ).validation;

    if (error instanceof ZodError || fastifyIssues) {
      const issues =
        error instanceof ZodError
          ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : fastifyIssues!.map((issue) => ({
              path: (issue.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.'),
              message: issue.message ?? 'Проверьте значение',
            }));

      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: issues[0]?.message ?? 'Проверьте заполненные поля',
        issues,
      });
    }

    const fallback = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = fallback.statusCode ?? 500;
    if (statusCode >= 500) request.log.error({ err: error }, 'Необработанная ошибка');

    return reply.code(statusCode).send({
      error: fallback.code ?? 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Внутренняя ошибка сервера' : fallback.message,
    });
  });

  app.get('/health', { schema: { hide: true } }, async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    storage: config.storage.enabled ? 'r2' : 'disabled',
  }));

  await app.register(
    async (api) => {
      // Публичная часть — без авторизации
      await api.register(catalogRoutes, { prefix: '/catalog' });
      await api.register(homeRoutes);
      await api.register(orderRoutes);
      await api.register(feedbackRoutes);

      // Админка. Логин и refresh открыты, всё остальное — под токеном.
      await api.register(
        async (admin) => {
          await admin.register(authRoutes, { prefix: '/auth' });

          await admin.register(async (secured) => {
            secured.addHook('onRequest', secured.authenticate);
            await secured.register(mediaRoutes);
            await secured.register(adminProductRoutes);
            await secured.register(adminContentRoutes);
            await secured.register(adminOrderRoutes);
            await secured.register(adminSystemRoutes);
            await secured.register(adminFinanceRoutes);
            await secured.register(adminFeedbackRoutes);
          });
        },
        { prefix: '/admin' },
      );
    },
    { prefix: config.apiPrefix },
  );

  return app;
};

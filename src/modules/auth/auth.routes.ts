import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/errors.js';
import { assertNotLocked, clearFailures, registerFailure } from './login-guard.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  consumeRefreshToken,
  issueRefreshToken,
  setRefreshCookie,
  verifyPassword,
} from './auth.service.js';

const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['OWNER', 'MANAGER', 'VIEWER']),
  prefs: z.record(z.string(), z.any()),
});

const sessionSchema = z.object({
  accessToken: z.string(),
  user: userSchema,
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      // Общий потолок против флуда; подбор пароля отсекает login-guard по неудачам
      config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
      schema: {
        tags: ['admin:auth'],
        summary: 'Вход в админку',
        body: z.object({
          email: z.string().email(),
          password: z.string().min(1),
        }),
        response: { 200: sessionSchema },
      },
    },
    async (request, reply) => {
      assertNotLocked(request.ip, request.body.email);

      const user = await prisma.user.findUnique({ where: { email: request.body.email } });

      // Одинаковый ответ на «нет пользователя» и «неверный пароль» —
      // чтобы нельзя было перебором узнать существующие адреса.
      const ok = user?.isActive
        ? await verifyPassword(user.passwordHash, request.body.password)
        : false;

      if (!user || !ok) {
        registerFailure(request.ip, request.body.email);
        throw unauthorized('Неверная почта или пароль');
      }

      clearFailures(request.ip, request.body.email);

      const { token, expiresAt } = await issueRefreshToken(user.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      setRefreshCookie(reply, token, expiresAt);

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return {
        accessToken: app.jwt.sign({ sub: user.id }),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          prefs: (user.prefs ?? {}) as Record<string, unknown>,
        },
      };
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['admin:auth'],
        summary: 'Обновление access-токена по refresh-cookie',
        response: { 200: sessionSchema },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw unauthorized('Сессия не найдена');

      const user = await consumeRefreshToken(token);
      if (!user) {
        clearRefreshCookie(reply);
        throw unauthorized('Сессия истекла — войдите заново');
      }

      const next = await issueRefreshToken(user.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      setRefreshCookie(reply, next.token, next.expiresAt);

      return {
        accessToken: app.jwt.sign({ sub: user.id }),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          prefs: (user.prefs ?? {}) as Record<string, unknown>,
        },
      };
    },
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['admin:auth'],
        summary: 'Выход: гасим refresh-токен',
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const token = request.cookies[REFRESH_COOKIE];
      if (token) {
        const { revokeRefreshToken } = await import('./auth.service.js');
        await revokeRefreshToken(token);
      }
      clearRefreshCookie(reply);
      return { ok: true };
    },
  );

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['admin:auth'],
        summary: 'Текущий пользователь и его настройки рабочего места',
        security: [{ bearerAuth: [] }],
        response: { 200: userSchema },
      },
    },
    async (request) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.authUser!.id },
      });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        prefs: (user.prefs ?? {}) as Record<string, unknown>,
      };
    },
  );

  app.patch(
    '/me/prefs',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['admin:auth'],
        summary: 'Сохранение настроек рабочего места (тема, плотность, дашборд, представления)',
        security: [{ bearerAuth: [] }],
        body: z.record(z.string(), z.any()),
        response: { 200: z.object({ prefs: z.record(z.string(), z.any()) }) },
      },
    },
    async (request) => {
      const user = await prisma.user.update({
        where: { id: request.authUser!.id },
        data: { prefs: request.body },
      });
      return { prefs: (user.prefs ?? {}) as Record<string, unknown> };
    },
  );
};

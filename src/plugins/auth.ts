import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { UserRole } from '@prisma/client';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Требует валидный access-токен. Кладёт пользователя в request.user. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Требует одну из перечисленных ролей (после authenticate). */
    requireRole: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

import type { FastifyReply, FastifyRequest } from 'fastify';

export const authPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: config.JWT_ACCESS_SECRET,
    sign: { expiresIn: config.JWT_ACCESS_TTL },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    let payload: { sub?: string };
    try {
      payload = await request.jwtVerify<{ sub?: string }>();
    } catch {
      throw unauthorized('Сессия истекла — войдите заново');
    }

    if (!payload.sub) throw unauthorized();

    // Роль и активность читаем из БД, а не из токена: отзыв доступа
    // должен срабатывать сразу, а не через 15 минут.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) throw unauthorized('Доступ отключён');

    request.authUser = user;
  });

  app.decorate(
    'requireRole',
    (...roles: UserRole[]) =>
      async (request: FastifyRequest) => {
        if (!request.authUser) throw unauthorized();
        if (!roles.includes(request.authUser.role)) {
          throw forbidden('Недостаточно прав для этого действия');
        }
      },
  );
});

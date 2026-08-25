import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { hashPassword } from '../auth/auth.service.js';
import { formatOrderNumber } from '../orders/orders.service.js';

const userRow = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['OWNER', 'MANAGER', 'VIEWER']),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const adminSystemRoutes: FastifyPluginAsyncZod = async (app) => {
  const ownerOnly = [app.authenticate, app.requireRole('OWNER')];

  // ─── Дашборд ────────────────────────────────────────────────────────────────

  app.get(
    '/stats',
    {
      schema: {
        tags: ['admin:system'],
        summary: 'Данные для виджетов дашборда',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            orders: z.object({
              today: z.number(),
              week: z.number(),
              new: z.number(),
              inProgress: z.number(),
            }),
            revenue: z.object({ today: z.number(), week: z.number(), month: z.number() }),
            catalog: z.object({
              products: z.number(),
              bundles: z.number(),
              hidden: z.number(),
              outOfStock: z.number(),
              withoutPhoto: z.number(),
            }),
            topProducts: z.array(
              z.object({ nameRu: z.string(), qty: z.number(), revenue: z.number() }),
            ),
            recentOrders: z.array(
              z.object({
                id: z.string(),
                number: z.string(),
                customerName: z.string(),
                total: z.number(),
                status: z.string(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async () => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
      const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

      // Тестовые заказы в статистику не попадают — иначе цифры врут.
      const real: Prisma.OrderWhereInput = { isTest: false };
      const paid: Prisma.OrderWhereInput = { ...real, status: { not: 'CANCELLED' } };

      const [
        ordersToday,
        ordersWeek,
        ordersNew,
        ordersInProgress,
        revToday,
        revWeek,
        revMonth,
        products,
        bundles,
        hidden,
        outOfStock,
        withoutPhoto,
        topItems,
        recent,
      ] = await Promise.all([
        prisma.order.count({ where: { ...real, createdAt: { gte: startOfToday } } }),
        prisma.order.count({ where: { ...real, createdAt: { gte: weekAgo } } }),
        prisma.order.count({ where: { ...real, status: 'NEW' } }),
        prisma.order.count({
          where: { ...real, status: { in: ['CONFIRMED', 'COOKING', 'DELIVERING'] } },
        }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: { ...paid, createdAt: { gte: startOfToday } },
        }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: { ...paid, createdAt: { gte: weekAgo } },
        }),
        prisma.order.aggregate({
          _sum: { total: true },
          where: { ...paid, createdAt: { gte: monthAgo } },
        }),
        prisma.product.count({ where: { type: 'SIMPLE' } }),
        prisma.product.count({ where: { type: 'BUNDLE' } }),
        prisma.product.count({ where: { isActive: false } }),
        prisma.product.count({ where: { stockStatus: 'OUT' } }),
        prisma.product.count({ where: { images: { none: {} } } }),
        prisma.orderItem.groupBy({
          by: ['nameRu'],
          _sum: { qty: true },
          where: { order: { ...paid, createdAt: { gte: monthAgo } } },
          orderBy: { _sum: { qty: 'desc' } },
          take: 5,
        }),
        prisma.order.findMany({
          where: real,
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            seq: true,
            customerName: true,
            total: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

      // Выручку по топ-позициям считаем отдельно: groupBy не умеет price × qty
      const topDetails = await Promise.all(
        topItems.map(async (item) => {
          const revenue = await prisma.orderItem.findMany({
            where: { nameRu: item.nameRu, order: { ...paid, createdAt: { gte: monthAgo } } },
            select: { price: true, qty: true },
          });
          return {
            nameRu: item.nameRu,
            qty: item._sum?.qty ?? 0,
            revenue: revenue.reduce((sum, row) => sum + row.price * row.qty, 0),
          };
        }),
      );

      return {
        orders: {
          today: ordersToday,
          week: ordersWeek,
          new: ordersNew,
          inProgress: ordersInProgress,
        },
        revenue: {
          today: revToday._sum?.total ?? 0,
          week: revWeek._sum?.total ?? 0,
          month: revMonth._sum?.total ?? 0,
        },
        catalog: { products, bundles, hidden, outOfStock, withoutPhoto },
        topProducts: topDetails,
        recentOrders: recent.map((order) => ({
          id: order.id,
          number: formatOrderNumber(order.seq),
          customerName: order.customerName,
          total: order.total,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── Журнал действий ────────────────────────────────────────────────────────

  app.get(
    '/audit',
    {
      schema: {
        tags: ['admin:system'],
        summary: 'Журнал действий пользователей',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          entity: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(80),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                entity: z.string(),
                entityId: z.string().nullable(),
                action: z.string(),
                diff: z.any().nullable(),
                userName: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const where = request.query.entity ? { entity: request.query.entity } : {};
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: request.query.limit,
          skip: request.query.offset,
          include: { user: { select: { name: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        total,
        items: items.map((row) => ({
          id: row.id,
          entity: row.entity,
          entityId: row.entityId,
          action: row.action,
          diff: row.diff ?? null,
          userName: row.user?.name ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── Пользователи ───────────────────────────────────────────────────────────

  app.get(
    '/users',
    {
      onRequest: ownerOnly,
      schema: {
        tags: ['admin:system'],
        summary: 'Пользователи админки',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(userRow) },
      },
    },
    async () => {
      const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      return users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      }));
    },
  );

  app.post(
    '/users',
    {
      onRequest: ownerOnly,
      schema: {
        tags: ['admin:system'],
        summary: 'Добавление пользователя',
        security: [{ bearerAuth: [] }],
        body: z.object({
          email: z.string().email(),
          name: z.string().trim().min(2),
          password: z.string().min(8, 'Пароль не короче 8 символов'),
          role: z.enum(['OWNER', 'MANAGER', 'VIEWER']).default('MANAGER'),
        }),
        response: { 201: userRow },
      },
    },
    async (request, reply) => {
      if (await prisma.user.findUnique({ where: { email: request.body.email } })) {
        throw conflict('Пользователь с такой почтой уже есть');
      }

      const user = await prisma.user.create({
        data: {
          email: request.body.email,
          name: request.body.name,
          role: request.body.role,
          passwordHash: await hashPassword(request.body.password),
        },
      });

      audit(request, { entity: 'user', entityId: user.id, action: 'create' });
      reply.code(201);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: null,
        createdAt: user.createdAt.toISOString(),
      };
    },
  );

  app.patch(
    '/users/:id',
    {
      onRequest: ownerOnly,
      schema: {
        tags: ['admin:system'],
        summary: 'Изменение роли, доступа или пароля',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().trim().min(2).optional(),
          role: z.enum(['OWNER', 'MANAGER', 'VIEWER']).optional(),
          isActive: z.boolean().optional(),
          password: z.string().min(8).optional(),
        }),
        response: { 200: userRow },
      },
    },
    async (request) => {
      const existing = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Пользователь');

      // Себя нельзя отключить или понизить — иначе можно закрыть себе вход навсегда.
      if (existing.id === request.authUser!.id) {
        if (request.body.isActive === false || (request.body.role && request.body.role !== 'OWNER')) {
          throw conflict('Нельзя отключить или понизить собственную учётную запись');
        }
      }

      const user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(request.body.name ? { name: request.body.name } : {}),
          ...(request.body.role ? { role: request.body.role } : {}),
          ...(request.body.isActive === undefined ? {} : { isActive: request.body.isActive }),
          ...(request.body.password
            ? { passwordHash: await hashPassword(request.body.password) }
            : {}),
        },
      });

      // Смена пароля или отключение — гасим все активные сессии пользователя.
      if (request.body.password || request.body.isActive === false) {
        await prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      audit(request, { entity: 'user', entityId: user.id, action: 'update' });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      };
    },
  );
};

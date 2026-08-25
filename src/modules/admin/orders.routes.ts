import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { getPublicSettings } from '../settings/settings.service.js';
import { buildChatLink, buildOrderMessage, formatOrderNumber } from '../orders/orders.service.js';

const statuses = ['NEW', 'CONFIRMED', 'COOKING', 'DELIVERING', 'DONE', 'CANCELLED'] as const;

const orderRow = z.object({
  id: z.string(),
  number: z.string(),
  customerName: z.string(),
  phone: z.string(),
  channel: z.enum(['WHATSAPP', 'TELEGRAM']),
  customerType: z.enum(['PERSON', 'BUSINESS']),
  deliveryType: z.enum(['DELIVERY', 'PICKUP']),
  address: z.string().nullable(),
  comment: z.string().nullable(),
  subtotal: z.number(),
  deliveryFee: z.number(),
  total: z.number(),
  status: z.enum(statuses),
  isTest: z.boolean(),
  isPaid: z.boolean(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  itemsCount: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      productId: z.string().nullable(),
      nameRu: z.string(),
      nameKk: z.string(),
      price: z.number(),
      qty: z.number(),
      weightLabel: z.string(),
    }),
  ),
  /** Готовая ссылка «написать клиенту» с текстом заказа */
  chatUrl: z.string(),
  events: z.array(
    z.object({
      id: z.string(),
      fromStatus: z.enum(statuses).nullable(),
      toStatus: z.enum(statuses),
      note: z.string().nullable(),
      userName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

const orderInclude = {
  items: true,
  events: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
} satisfies Prisma.OrderInclude;

type OrderWith = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const serialize = (
  order: OrderWith,
  contacts: { whatsapp: string; telegram: string },
) => {
  const number = formatOrderNumber(order.seq);
  const message = buildOrderMessage({
    number,
    customerName: order.customerName,
    deliveryType: order.deliveryType,
    address: order.address,
    comment: order.comment,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    items: order.items.map((item) => ({
      name: { ru: item.nameRu, kk: item.nameKk },
      qty: item.qty,
      price: item.price,
      weightLabel: item.weightLabel,
    })),
  });

  return {
    id: order.id,
    number,
    customerName: order.customerName,
    phone: order.phone,
    channel: order.channel,
    customerType: order.customerType,
    deliveryType: order.deliveryType,
    address: order.address,
    comment: order.comment,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    status: order.status,
    isTest: order.isTest,
    isPaid: order.isPaid,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    itemsCount: order.items.reduce((sum, item) => sum + item.qty, 0),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      nameRu: item.nameRu,
      nameKk: item.nameKk,
      price: item.price,
      qty: item.qty,
      weightLabel: item.weightLabel,
    })),
    // Пишем клиенту на его номер, а не на общий — поэтому ссылка строится по phone
    chatUrl: buildChatLink(
      order.channel,
      { whatsapp: order.phone, telegram: contacts.telegram },
      message,
    ),
    events: order.events.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      userName: event.user?.name ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
};

export const adminOrderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/orders',
    {
      schema: {
        tags: ['admin:orders'],
        summary: 'Заявки с витрины',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          status: z.enum(statuses).optional(),
          search: z.string().optional(),
          /** По умолчанию тестовые заказы Playwright скрыты */
          includeTest: z.coerce.boolean().default(false),
          paid: z.enum(['yes', 'no']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: { 200: z.object({ items: z.array(orderRow), total: z.number() }) },
      },
    },
    async (request) => {
      const { status, search, includeTest, paid, limit, offset } = request.query;
      const seq = search ? Number.parseInt(search.replace(/\D/g, ''), 10) : NaN;

      const where: Prisma.OrderWhereInput = {
        ...(status ? { status } : {}),
        ...(includeTest ? {} : { isTest: false }),
        ...(paid ? { isPaid: paid === 'yes' } : {}),
        ...(search
          ? {
              OR: [
                { customerName: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                ...(Number.isNaN(seq) ? [] : [{ seq }]),
              ],
            }
          : {}),
      };

      const [items, total, settings] = await Promise.all([
        prisma.order.findMany({
          where,
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.order.count({ where }),
        getPublicSettings(),
      ]);

      return { items: items.map((order) => serialize(order, settings.contacts)), total };
    },
  );

  app.patch(
    '/orders/:id/status',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:orders'],
        summary: 'Смена статуса заказа (канбан)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({
          status: z.enum(statuses),
          note: z.string().trim().max(500).optional(),
        }),
        response: { 200: orderRow },
      },
    },
    async (request) => {
      const existing = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Заказ');

      const [order, settings] = await Promise.all([
        prisma.order.update({
          where: { id: existing.id },
          data: {
            status: request.body.status,
            events: {
              create: {
                fromStatus: existing.status,
                toStatus: request.body.status,
                note: request.body.note ?? null,
                userId: request.authUser!.id,
              },
            },
          },
          include: orderInclude,
        }),
        getPublicSettings(),
      ]);

      audit(request, {
        entity: 'order',
        entityId: order.id,
        action: 'update',
        diff: { status: { from: existing.status, to: request.body.status } },
      });

      return serialize(order, settings.contacts);
    },
  );

  app.patch(
    '/orders/:id/paid',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:orders'],
        summary: 'Отметка об оплате',
        description:
          'Сейчас ставится вручную: Kaspi Pay не сообщает сайту об оплате по ссылке. ' +
          'Эти же поля будет заполнять callback эквайринга, когда он появится.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({ isPaid: z.boolean() }),
        response: { 200: orderRow },
      },
    },
    async (request) => {
      const existing = await prisma.order.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Заказ');

      const [order, settings] = await Promise.all([
        prisma.order.update({
          where: { id: existing.id },
          data: {
            isPaid: request.body.isPaid,
            paidAt: request.body.isPaid ? (existing.paidAt ?? new Date()) : null,
          },
          include: orderInclude,
        }),
        getPublicSettings(),
      ]);

      audit(request, {
        entity: 'order',
        entityId: order.id,
        action: 'update',
        diff: { isPaid: { from: existing.isPaid, to: request.body.isPaid } },
      });

      return serialize(order, settings.contacts);
    },
  );

  app.delete(
    '/orders/test',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:orders'],
        summary: 'Очистка тестовых заказов, созданных прогонами Playwright',
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ deleted: z.number() }) },
      },
    },
    async (request) => {
      const result = await prisma.order.deleteMany({ where: { isTest: true } });
      audit(request, { entity: 'order', action: 'bulk', diff: { deletedTest: result.count } });
      return { deleted: result.count };
    },
  );
};

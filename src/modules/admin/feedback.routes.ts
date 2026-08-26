import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { booleanQuery } from '../../lib/query.js';
import { notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { getPublicSettings } from '../settings/settings.service.js';
import { buildChatLink } from '../orders/orders.service.js';
import { feedbackKinds } from '../feedback/feedback.routes.js';

const feedbackRow = z.object({
  id: z.string(),
  kind: z.enum(feedbackKinds),
  name: z.string(),
  contact: z.string().nullable(),
  message: z.string(),
  locale: z.string(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  isTest: z.boolean(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  /**
   * Готовая ссылка «ответить». Строится, только если человек оставил контакт,
   * и только по номеру телефона — по нику в мессенджере адрес не собрать.
   */
  replyUrl: z.string().nullable(),
});

type FeedbackRow = Prisma.FeedbackGetPayload<Record<string, never>>;

/** Похоже ли на телефон: цифр столько, что из них собирается номер. */
const asPhone = (contact: string | null) => {
  if (!contact) return null;
  const digits = contact.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};

const serialize = (row: FeedbackRow, telegram: string) => {
  const phone = asPhone(row.contact);

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    contact: row.contact,
    message: row.message,
    locale: row.locale,
    isRead: row.isRead,
    readAt: row.readAt?.toISOString() ?? null,
    isTest: row.isTest,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    replyUrl: phone
      ? buildChatLink(
          'WHATSAPP',
          { whatsapp: phone, telegram },
          row.locale === 'kk'
            ? `Сәлеметсіз бе, ${row.name}! Хабарламаңыз үшін рақмет.`
            : `Здравствуйте, ${row.name}! Спасибо за сообщение.`,
        )
      : null,
  };
};

export const adminFeedbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/feedback',
    {
      schema: {
        tags: ['admin:feedback'],
        summary: 'Сообщения с витрины',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          kind: z.enum(feedbackKinds).optional(),
          /** 'no' — только непрочитанные, 'yes' — только прочитанные */
          read: z.enum(['yes', 'no']).optional(),
          search: z.string().optional(),
          includeTest: booleanQuery.default(false),
          archived: z.enum(['no', 'only', 'all']).default('no'),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(feedbackRow),
            total: z.number(),
            /** Для счётчика в меню: столько непрочитанных вне архива */
            unread: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { kind, read, search, includeTest, archived, limit, offset } = request.query;

      const where: Prisma.FeedbackWhereInput = {
        ...(kind ? { kind } : {}),
        ...(read ? { isRead: read === 'yes' } : {}),
        ...(includeTest ? {} : { isTest: false }),
        ...(archived === 'all' ? {} : { archivedAt: archived === 'only' ? { not: null } : null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { message: { contains: search, mode: 'insensitive' } },
                { contact: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [items, total, unread, settings] = await Promise.all([
        prisma.feedback.findMany({
          where,
          orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
          take: limit,
          skip: offset,
        }),
        prisma.feedback.count({ where }),
        prisma.feedback.count({ where: { isRead: false, isTest: false, archivedAt: null } }),
        getPublicSettings(),
      ]);

      return {
        items: items.map((row) => serialize(row, settings.contacts.telegram)),
        total,
        unread,
      };
    },
  );

  /**
   * Отдельная дешёвая ручка под счётчик в меню кабинета: она опрашивается с любой
   * страницы, и гонять ради одного числа весь список или всю статистику дашборда
   * было бы расточительно.
   */
  app.get(
    '/feedback/unread',
    {
      schema: {
        tags: ['admin:feedback'],
        summary: 'Сколько непрочитанных сообщений',
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ unread: z.number() }) },
      },
    },
    async () => ({
      unread: await prisma.feedback.count({
        where: { isRead: false, isTest: false, archivedAt: null },
      }),
    }),
  );

  app.patch(
    '/feedback/:id/read',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:feedback'],
        summary: 'Отметка «прочитано»',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({ isRead: z.boolean() }),
        response: { 200: feedbackRow },
      },
    },
    async (request) => {
      const existing = await prisma.feedback.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Сообщение');

      const [row, settings] = await Promise.all([
        prisma.feedback.update({
          where: { id: existing.id },
          data: {
            isRead: request.body.isRead,
            // Повторный вызов не сдвигает дату прочтения — операция идемпотентна
            readAt: request.body.isRead ? (existing.readAt ?? new Date()) : null,
          },
        }),
        getPublicSettings(),
      ]);

      return serialize(row, settings.contacts.telegram);
    },
  );

  app.patch(
    '/feedback/:id/archive',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:feedback'],
        summary: 'Архивация сообщения (мягкая альтернатива удалению)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({ archived: z.boolean() }),
        response: { 200: feedbackRow },
      },
    },
    async (request) => {
      const existing = await prisma.feedback.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Сообщение');

      const [row, settings] = await Promise.all([
        prisma.feedback.update({
          where: { id: existing.id },
          data: {
            archivedAt: request.body.archived ? (existing.archivedAt ?? new Date()) : null,
            // Уходящее в архив не должно продолжать светиться счётчиком непрочитанных
            ...(request.body.archived && !existing.isRead
              ? { isRead: true, readAt: new Date() }
              : {}),
          },
        }),
        getPublicSettings(),
      ]);

      audit(request, {
        entity: 'feedback',
        entityId: row.id,
        action: 'update',
        diff: { archived: { from: Boolean(existing.archivedAt), to: request.body.archived } },
      });

      return serialize(row, settings.contacts.telegram);
    },
  );

  app.delete(
    '/feedback/test',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:feedback'],
        summary: 'Очистка сообщений, созданных прогонами Playwright',
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ deleted: z.number() }) },
      },
    },
    async (request) => {
      const result = await prisma.feedback.deleteMany({ where: { isTest: true } });
      audit(request, { entity: 'feedback', action: 'bulk', diff: { deletedTest: result.count } });
      return { deleted: result.count };
    },
  );
};

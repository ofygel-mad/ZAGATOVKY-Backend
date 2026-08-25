import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { settingsGroups, publicSettingsSchema } from '../settings/settings.service.js';
import { makeSlug } from './products.routes.js';

const localizedText = z.string().trim().min(1);

const categoryBody = z.object({
  slug: z.string().trim().optional(),
  nameRu: localizedText,
  nameKk: localizedText,
  descriptionRu: z.string().trim().nullish(),
  descriptionKk: z.string().trim().nullish(),
  imageId: z.string().nullish(),
  sortOrder: z.number().int().default(0),
  isVisible: z.boolean().default(true),
});

const categoryRow = z.object({
  id: z.string(),
  slug: z.string(),
  nameRu: z.string(),
  nameKk: z.string(),
  descriptionRu: z.string().nullable(),
  descriptionKk: z.string().nullable(),
  imageId: z.string().nullable(),
  sortOrder: z.number(),
  isVisible: z.boolean(),
  productCount: z.number(),
});

const collectionBody = z.object({
  slug: z.string().trim().optional(),
  titleRu: localizedText,
  titleKk: localizedText,
  subtitleRu: z.string().trim().nullish(),
  subtitleKk: z.string().trim().nullish(),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  productIds: z.array(z.string()).default([]),
});

const collectionRow = z.object({
  id: z.string(),
  slug: z.string(),
  titleRu: z.string(),
  titleKk: z.string(),
  subtitleRu: z.string().nullable(),
  subtitleKk: z.string().nullable(),
  isVisible: z.boolean(),
  sortOrder: z.number(),
  productIds: z.array(z.string()),
});

const homeSectionKinds = [
  'HERO',
  'COLLECTION',
  'BUNDLES',
  'CATEGORIES',
  'EDITORIAL',
  'BANNER',
  'STEPS',
  'FAQ',
  'CONTACTS',
] as const;

const homeSectionRow = z.object({
  id: z.string(),
  kind: z.enum(homeSectionKinds),
  payload: z.record(z.string(), z.any()),
  sortOrder: z.number(),
  isVisible: z.boolean(),
});

export const adminContentRoutes: FastifyPluginAsyncZod = async (app) => {
  const editors = [app.authenticate, app.requireRole('OWNER', 'MANAGER')];

  // ─── Категории ──────────────────────────────────────────────────────────────

  app.get(
    '/categories',
    {
      schema: {
        tags: ['admin:content'],
        summary: 'Категории (включая скрытые)',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(categoryRow) },
      },
    },
    async () => {
      const rows = await prisma.category.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { products: true } } },
      });
      return rows.map(({ _count, createdAt: _c, updatedAt: _u, ...rest }) => ({
        ...rest,
        productCount: _count.products,
      }));
    },
  );

  app.post(
    '/categories',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Создание категории',
        security: [{ bearerAuth: [] }],
        body: categoryBody,
        response: { 201: categoryRow },
      },
    },
    async (request, reply) => {
      const slug = request.body.slug?.trim() || makeSlug(request.body.nameRu);
      if (await prisma.category.findUnique({ where: { slug } })) {
        throw conflict(`Категория «${slug}» уже есть`);
      }

      const created = await prisma.category.create({
        data: {
          slug,
          nameRu: request.body.nameRu,
          nameKk: request.body.nameKk,
          descriptionRu: request.body.descriptionRu ?? null,
          descriptionKk: request.body.descriptionKk ?? null,
          imageId: request.body.imageId ?? null,
          sortOrder: request.body.sortOrder,
          isVisible: request.body.isVisible,
        },
      });

      audit(request, { entity: 'category', entityId: created.id, action: 'create' });
      reply.code(201);
      const { createdAt: _c, updatedAt: _u, ...rest } = created;
      return { ...rest, productCount: 0 };
    },
  );

  app.put(
    '/categories/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Обновление категории',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: categoryBody,
        response: { 200: categoryRow },
      },
    },
    async (request) => {
      const existing = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Категория');

      const updated = await prisma.category.update({
        where: { id: existing.id },
        data: {
          slug: request.body.slug?.trim() || existing.slug,
          nameRu: request.body.nameRu,
          nameKk: request.body.nameKk,
          descriptionRu: request.body.descriptionRu ?? null,
          descriptionKk: request.body.descriptionKk ?? null,
          imageId: request.body.imageId ?? null,
          sortOrder: request.body.sortOrder,
          isVisible: request.body.isVisible,
        },
        include: { _count: { select: { products: true } } },
      });

      audit(request, { entity: 'category', entityId: updated.id, action: 'update' });
      const { _count, createdAt: _c, updatedAt: _u, ...rest } = updated;
      return { ...rest, productCount: _count.products };
    },
  );

  app.delete(
    '/categories/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Удаление категории',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      // Товары не удаляем — они просто останутся без категории (onDelete: SetNull).
      await prisma.category.delete({ where: { id: request.params.id } }).catch(() => {
        throw notFound('Категория');
      });
      audit(request, { entity: 'category', entityId: request.params.id, action: 'delete' });
      return { ok: true };
    },
  );

  // ─── Подборки ───────────────────────────────────────────────────────────────

  app.get(
    '/collections',
    {
      schema: {
        tags: ['admin:content'],
        summary: 'Подборки товаров',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(collectionRow) },
      },
    },
    async () => {
      const rows = await prisma.collection.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { products: { orderBy: { sortOrder: 'asc' } } },
      });
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        titleRu: row.titleRu,
        titleKk: row.titleKk,
        subtitleRu: row.subtitleRu,
        subtitleKk: row.subtitleKk,
        isVisible: row.isVisible,
        sortOrder: row.sortOrder,
        productIds: row.products.map((item) => item.productId),
      }));
    },
  );

  const saveCollection = async (id: string | null, body: z.infer<typeof collectionBody>) => {
    const slug = body.slug?.trim() || makeSlug(body.titleRu);

    return prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.collection.update({
            where: { id },
            data: {
              slug,
              titleRu: body.titleRu,
              titleKk: body.titleKk,
              subtitleRu: body.subtitleRu ?? null,
              subtitleKk: body.subtitleKk ?? null,
              isVisible: body.isVisible,
              sortOrder: body.sortOrder,
            },
          })
        : await tx.collection.create({
            data: {
              slug,
              titleRu: body.titleRu,
              titleKk: body.titleKk,
              subtitleRu: body.subtitleRu ?? null,
              subtitleKk: body.subtitleKk ?? null,
              isVisible: body.isVisible,
              sortOrder: body.sortOrder,
            },
          });

      await tx.collectionProduct.deleteMany({ where: { collectionId: row.id } });
      if (body.productIds.length) {
        await tx.collectionProduct.createMany({
          data: body.productIds.map((productId, index) => ({
            collectionId: row.id,
            productId,
            sortOrder: index * 10,
          })),
        });
      }

      return { ...row, productIds: body.productIds };
    });
  };

  app.post(
    '/collections',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Создание подборки',
        security: [{ bearerAuth: [] }],
        body: collectionBody,
        response: { 201: collectionRow },
      },
    },
    async (request, reply) => {
      const row = await saveCollection(null, request.body);
      audit(request, { entity: 'collection', entityId: row.id, action: 'create' });
      reply.code(201);
      return row;
    },
  );

  app.put(
    '/collections/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Обновление подборки и её состава',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: collectionBody,
        response: { 200: collectionRow },
      },
    },
    async (request) => {
      const row = await saveCollection(request.params.id, request.body);
      audit(request, { entity: 'collection', entityId: row.id, action: 'update' });
      return row;
    },
  );

  app.delete(
    '/collections/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Удаление подборки',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      await prisma.collection.delete({ where: { id: request.params.id } }).catch(() => {
        throw notFound('Подборка');
      });
      audit(request, { entity: 'collection', entityId: request.params.id, action: 'delete' });
      return { ok: true };
    },
  );

  // ─── Конструктор главной ────────────────────────────────────────────────────

  app.get(
    '/home-sections',
    {
      schema: {
        tags: ['admin:content'],
        summary: 'Секции главной страницы, включая скрытые',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(homeSectionRow) },
      },
    },
    async () => {
      const rows = await prisma.homeSection.findMany({ orderBy: { sortOrder: 'asc' } });
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        sortOrder: row.sortOrder,
        isVisible: row.isVisible,
      }));
    },
  );

  app.post(
    '/home-sections',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Добавление секции на главную',
        security: [{ bearerAuth: [] }],
        body: z.object({
          kind: z.enum(homeSectionKinds),
          payload: z.record(z.string(), z.any()).default({}),
          sortOrder: z.number().int().default(0),
          isVisible: z.boolean().default(true),
        }),
        response: { 201: homeSectionRow },
      },
    },
    async (request, reply) => {
      const row = await prisma.homeSection.create({ data: request.body });
      audit(request, { entity: 'homeSection', entityId: row.id, action: 'create' });
      reply.code(201);
      return {
        id: row.id,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        sortOrder: row.sortOrder,
        isVisible: row.isVisible,
      };
    },
  );

  app.put(
    '/home-sections/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Редактирование секции главной',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z.object({
          payload: z.record(z.string(), z.any()),
          isVisible: z.boolean(),
          sortOrder: z.number().int(),
        }),
        response: { 200: homeSectionRow },
      },
    },
    async (request) => {
      const row = await prisma.homeSection
        .update({ where: { id: request.params.id }, data: request.body })
        .catch(() => {
          throw notFound('Секция');
        });

      audit(request, { entity: 'homeSection', entityId: row.id, action: 'update' });
      return {
        id: row.id,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        sortOrder: row.sortOrder,
        isVisible: row.isVisible,
      };
    },
  );

  app.patch(
    '/home-sections/reorder',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Порядок секций главной (drag & drop)',
        security: [{ bearerAuth: [] }],
        body: z.object({ ids: z.array(z.string()).min(1) }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      await prisma.$transaction(
        request.body.ids.map((id, index) =>
          prisma.homeSection.update({ where: { id }, data: { sortOrder: index * 10 } }),
        ),
      );
      audit(request, { entity: 'homeSection', action: 'bulk', diff: { reorder: request.body.ids } });
      return { ok: true };
    },
  );

  app.delete(
    '/home-sections/:id',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Удаление секции главной',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      await prisma.homeSection.delete({ where: { id: request.params.id } }).catch(() => {
        throw notFound('Секция');
      });
      audit(request, { entity: 'homeSection', entityId: request.params.id, action: 'delete' });
      return { ok: true };
    },
  );

  // ─── Настройки сайта ────────────────────────────────────────────────────────

  app.put(
    '/settings/:group',
    {
      onRequest: editors,
      schema: {
        tags: ['admin:content'],
        summary: 'Сохранение группы настроек (контакты, доставка, бренд)',
        security: [{ bearerAuth: [] }],
        params: z.object({ group: z.enum(['contacts', 'delivery', 'brand']) }),
        body: z.record(z.string(), z.any()),
        response: { 200: publicSettingsSchema.partial() },
      },
    },
    async (request) => {
      const group = settingsGroups[request.params.group];
      const parsed = group.schema.safeParse({ ...group.defaults, ...request.body });

      if (!parsed.success) {
        throw conflict(parsed.error.issues[0]?.message ?? 'Некорректные настройки');
      }

      await prisma.siteSetting.upsert({
        where: { key: request.params.group },
        update: { value: parsed.data },
        create: { key: request.params.group, value: parsed.data },
      });

      audit(request, {
        entity: 'settings',
        entityId: request.params.group,
        action: 'update',
        diff: parsed.data,
      });

      return { [request.params.group]: parsed.data } as never;
    },
  );

  // ─── Бейджи ─────────────────────────────────────────────────────────────────

  app.get(
    '/badges',
    {
      schema: {
        tags: ['admin:content'],
        summary: 'Справочник бейджей',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              code: z.string(),
              labelRu: z.string(),
              labelKk: z.string(),
              tone: z.enum(['GOLD', 'TEAL', 'STONE']),
            }),
          ),
        },
      },
    },
    async () => {
      const rows = await prisma.badge.findMany({ orderBy: { code: 'asc' } });
      return rows.map(({ icon: _icon, ...rest }) => rest);
    },
  );
};

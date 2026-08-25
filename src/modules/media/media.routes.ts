import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { booleanQuery } from '../../lib/query.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../lib/audit.js';
import { config } from '../../config.js';
import { deleteObject, processAndUpload } from './media.service.js';

const assetSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  mime: z.string(),
  lqip: z.string().nullable(),
  originalName: z.string().nullable(),
  createdAt: z.string(),
  /** Сколько товаров и категорий используют это фото — защита от случайного удаления */
  usageCount: z.number(),
});

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/media',
    {
      schema: {
        tags: ['admin:media'],
        summary: 'Медиатека',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(60),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(assetSchema),
            total: z.number(),
            storageEnabled: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const [items, total] = await Promise.all([
        prisma.mediaAsset.findMany({
          orderBy: { createdAt: 'desc' },
          take: request.query.limit,
          skip: request.query.offset,
          include: { _count: { select: { productImages: true, categories: true } } },
        }),
        prisma.mediaAsset.count(),
      ]);

      return {
        storageEnabled: config.storage.enabled,
        total,
        items: items.map((asset) => ({
          id: asset.id,
          url: asset.url,
          width: asset.width,
          height: asset.height,
          bytes: asset.bytes,
          mime: asset.mime,
          lqip: asset.lqip,
          originalName: asset.originalName,
          createdAt: asset.createdAt.toISOString(),
          usageCount: asset._count.productImages + asset._count.categories,
        })),
      };
    },
  );

  app.post(
    '/media',
    {
      config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
      schema: {
        tags: ['admin:media'],
        summary: 'Загрузка фото: ресайз, WebP, LQIP и отправка в R2',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
        response: { 201: assetSchema },
      },
    },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 15 * 1024 * 1024 } });
      if (!file) throw badRequest('Файл не получен');

      const buffer = await file.toBuffer();
      const processed = await processAndUpload(buffer, file.mimetype);

      const asset = await prisma.mediaAsset.create({
        data: {
          key: processed.key,
          url: processed.url,
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
          mime: processed.mime,
          lqip: processed.lqip,
          originalName: file.filename?.slice(0, 200) ?? null,
          createdById: request.authUser!.id,
        },
      });

      audit(request, { entity: 'media', entityId: asset.id, action: 'create' });

      reply.code(201);
      return {
        id: asset.id,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        bytes: asset.bytes,
        mime: asset.mime,
        lqip: asset.lqip,
        originalName: asset.originalName,
        createdAt: asset.createdAt.toISOString(),
        usageCount: 0,
      };
    },
  );

  app.delete(
    '/media/:id',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:media'],
        summary: 'Удаление файла из медиатеки и из R2',
        description:
          'Если фото где-то используется, запрос отклоняется и возвращает список мест. ' +
          'С force=true оно сначала отвязывается от товаров и категорий, а потом удаляется.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        querystring: z.object({ force: booleanQuery.default(false) }),
        response: { 200: z.object({ ok: z.boolean(), detached: z.number() }) },
      },
    },
    async (request) => {
      const asset = await prisma.mediaAsset.findUnique({
        where: { id: request.params.id },
        include: {
          productImages: { select: { product: { select: { nameRu: true } } } },
          categories: { select: { nameRu: true } },
        },
      });

      if (!asset) throw notFound('Файл');

      const usedBy = [
        ...asset.productImages.map((link) => link.product.nameRu),
        ...asset.categories.map((category) => category.nameRu),
      ];

      // Без force удаление остаётся безопасным: сначала показываем, что сломается.
      if (usedBy.length > 0 && !request.query.force) {
        throw conflict(
          `Фото используется: ${usedBy.slice(0, 5).join(', ')}` +
            (usedBy.length > 5 ? ` и ещё ${usedBy.length - 5}` : ''),
        );
      }

      await prisma.$transaction(async (tx) => {
        if (usedBy.length > 0) {
          await tx.productImage.deleteMany({ where: { assetId: asset.id } });
          await tx.category.updateMany({
            where: { imageId: asset.id },
            data: { imageId: null },
          });
        }
        await tx.mediaAsset.delete({ where: { id: asset.id } });
      });

      // Объект в R2 убираем после БД: если хранилище недоступно, запись всё равно ушла,
      // и в медиатеке не останется битой карточки.
      await deleteObject(asset.key).catch((error: unknown) =>
        request.log.warn({ err: error }, 'Файл не удалён из R2, запись всё равно убрана'),
      );

      audit(request, {
        entity: 'media',
        entityId: asset.id,
        action: 'delete',
        diff: usedBy.length ? { detachedFrom: usedBy } : undefined,
      });
      return { ok: true, detached: usedBy.length };
    },
  );
};

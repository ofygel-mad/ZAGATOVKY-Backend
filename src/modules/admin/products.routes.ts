import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, diffOf } from '../../lib/audit.js';
import { productDetailInclude, serializeProductDetail } from '../catalog/catalog.serializers.js';
import { productDetailSchema } from '../catalog/catalog.schemas.js';

/** Транслитерация кириллицы (включая казахские буквы) для slug из названия. */
const translit: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u',
  һ: 'h', і: 'i',
};

export const makeSlug = (value: string) => {
  const latin = value
    .toLowerCase()
    .split('')
    .map((char) => translit[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return latin || `item-${Date.now()}`;
};

const productBodySchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  type: z.enum(['SIMPLE', 'BUNDLE']).default('SIMPLE'),
  nameRu: z.string().trim().min(1, 'Укажите название'),
  nameKk: z.string().trim().min(1, 'Укажите название на казахском'),
  shortRu: z.string().trim().max(200).nullish(),
  shortKk: z.string().trim().max(200).nullish(),
  descriptionRu: z.string().trim().max(4000).nullish(),
  descriptionKk: z.string().trim().max(4000).nullish(),
  /*
   * Нижняя граница — 1, а не 0. Цена 0 сохранялась молча, карточка показывала
   * «0 тг», и товар спокойно клался в корзину: одна опечатка в поле цены — и
   * заготовки уезжают бесплатно (самовывоз минимальную сумму не проверяет).
   * Верхняя граница — защита от лишнего нуля при наборе.
   */
  price: z
    .number()
    .int('Цена указывается в целых тенге')
    .min(1, 'Цена должна быть больше нуля')
    .max(10_000_000, 'Цена выглядит ошибочной — проверьте количество нулей'),
  compareAtPrice: z
    .number()
    .int('Старая цена указывается в целых тенге')
    .min(1, 'Старая цена должна быть больше нуля')
    .max(10_000_000, 'Старая цена выглядит ошибочной — проверьте количество нулей')
    .nullish(),
  /** Себестоимость — только для отчётов, на витрину не отдаётся */
  costPrice: z.number().int().min(0).max(10_000_000).nullish(),
  /*
   * Вес 0 тоже принимался: карточка писала «0 Г», а строка «за 100 г»
   * пропадала — покупатель не понимал, что берёт.
   */
  weightValue: z.number().int().min(1, 'Укажите вес или объём порции'),
  weightUnit: z.enum(['G', 'ML', 'PORTION', 'PCS']).default('G'),
  categoryId: z.string().nullish(),
  stockStatus: z.enum(['IN_STOCK', 'LOW', 'OUT']).default('IN_STOCK'),
  stockQty: z.number().int().min(0).nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  seoTitleRu: z.string().trim().max(200).nullish(),
  seoTitleKk: z.string().trim().max(200).nullish(),
  seoDescRu: z.string().trim().max(400).nullish(),
  seoDescKk: z.string().trim().max(400).nullish(),
  /** Полный список фото в нужном порядке — проще, чем отдельные ручки на каждое действие */
  images: z
    .array(
      z.object({
        assetId: z.string(),
        altRu: z.string().nullish(),
        altKk: z.string().nullish(),
      }),
    )
    .default([]),
  badgeCodes: z.array(z.string()).default([]),
  /** Состав набора. Для SIMPLE игнорируется. */
  bundleItems: z
    .array(z.object({ componentId: z.string(), qty: z.number().int().min(1).max(20) }))
    .default([]),
}).superRefine((value, ctx) => {
  /*
   * «Старая цена» ниже текущей рисовала скидку наоборот: карточка показывала
   * зачёркнутые 10 ₸ рядом с настоящими 330 ₸. Это не украшение, а прямая
   * дезинформация покупателя, поэтому отсекаем на входе.
   */
  if (
    value.compareAtPrice !== null &&
    value.compareAtPrice !== undefined &&
    value.compareAtPrice <= value.price
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['compareAtPrice'],
      message: 'Старая цена должна быть выше текущей — иначе скидка выглядит наоборот',
    });
  }
});

const listItemSchema = productDetailSchema.extend({
  isActive: z.boolean(),
  sortOrder: z.number(),
  stockQty: z.number().nullable(),
  costPrice: z.number().nullable(),
  updatedAt: z.string(),
});

/** Дополняет публичную форму служебными полями, нужными только админке. */
const toAdminProduct = (product: Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>) => ({
  ...serializeProductDetail(product),
  isActive: product.isActive,
  sortOrder: product.sortOrder,
  stockQty: product.stockQty,
  costPrice: product.costPrice,
  updatedAt: product.updatedAt.toISOString(),
});

const writeRelations = async (
  tx: Prisma.TransactionClient,
  productId: string,
  body: z.infer<typeof productBodySchema>,
) => {
  await tx.productImage.deleteMany({ where: { productId } });
  if (body.images.length) {
    await tx.productImage.createMany({
      data: body.images.map((image, index) => ({
        productId,
        assetId: image.assetId,
        altRu: image.altRu ?? null,
        altKk: image.altKk ?? null,
        sortOrder: index * 10,
      })),
    });
  }

  await tx.productBadge.deleteMany({ where: { productId } });
  if (body.badgeCodes.length) {
    const badges = await tx.badge.findMany({ where: { code: { in: body.badgeCodes } } });
    await tx.productBadge.createMany({
      data: badges.map((badge) => ({ productId, badgeId: badge.id })),
    });
  }

  await tx.bundleItem.deleteMany({ where: { bundleId: productId } });
  if (body.type === 'BUNDLE' && body.bundleItems.length) {
    await tx.bundleItem.createMany({
      data: body.bundleItems.map((item, index) => ({
        bundleId: productId,
        componentId: item.componentId,
        qty: item.qty,
        sortOrder: index * 10,
      })),
    });
  }
};

export const adminProductRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/products',
    {
      schema: {
        tags: ['admin:catalog'],
        summary: 'Товары для таблицы админки (включая скрытые)',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          search: z.string().optional(),
          category: z.string().optional(),
          type: z.enum(['SIMPLE', 'BUNDLE']).optional(),
          status: z.enum(['active', 'hidden', 'out', 'nophoto']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: { 200: z.object({ items: z.array(listItemSchema), total: z.number() }) },
      },
    },
    async (request) => {
      const { search, category, type, status, limit, offset } = request.query;

      const where: Prisma.ProductWhereInput = {
        ...(category ? { category: { slug: category } } : {}),
        ...(type ? { type } : {}),
        ...(status === 'active' ? { isActive: true } : {}),
        ...(status === 'hidden' ? { isActive: false } : {}),
        ...(status === 'out' ? { stockStatus: 'OUT' } : {}),
        // Товары без единого снимка — витрина показывает вместо них буквенную заглушку
        ...(status === 'nophoto' ? { images: { none: {} } } : {}),
        ...(search
          ? {
              OR: [
                { nameRu: { contains: search, mode: 'insensitive' } },
                { nameKk: { contains: search, mode: 'insensitive' } },
                { slug: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: productDetailInclude,
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          take: limit,
          skip: offset,
        }),
        prisma.product.count({ where }),
      ]);

      return { items: items.map(toAdminProduct), total };
    },
  );

  app.get(
    '/products/:id',
    {
      schema: {
        tags: ['admin:catalog'],
        summary: 'Товар целиком для редактора',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: listItemSchema },
      },
    },
    async (request) => {
      const product = await prisma.product.findUnique({
        where: { id: request.params.id },
        include: productDetailInclude,
      });
      if (!product) throw notFound('Товар');
      return toAdminProduct(product);
    },
  );

  app.post(
    '/products',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:catalog'],
        summary: 'Создание товара или набора',
        security: [{ bearerAuth: [] }],
        body: productBodySchema,
        response: { 201: listItemSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const slug = body.slug?.trim() || makeSlug(body.nameRu);

      if (await prisma.product.findUnique({ where: { slug } })) {
        throw conflict(`Товар с адресом «${slug}» уже есть — измените ссылку`);
      }
      if (body.type === 'BUNDLE' && body.bundleItems.length === 0) {
        throw badRequest('В наборе должна быть хотя бы одна позиция');
      }

      const product = await prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            slug,
            type: body.type,
            nameRu: body.nameRu,
            nameKk: body.nameKk,
            shortRu: body.shortRu ?? null,
            shortKk: body.shortKk ?? null,
            descriptionRu: body.descriptionRu ?? null,
            descriptionKk: body.descriptionKk ?? null,
            price: body.price,
            compareAtPrice: body.compareAtPrice ?? null,
            costPrice: body.costPrice ?? null,
            weightValue: body.weightValue,
            weightUnit: body.weightUnit,
            categoryId: body.categoryId ?? null,
            stockStatus: body.stockStatus,
            stockQty: body.stockQty ?? null,
            isActive: body.isActive,
            isFeatured: body.isFeatured,
            sortOrder: body.sortOrder,
            seoTitleRu: body.seoTitleRu ?? null,
            seoTitleKk: body.seoTitleKk ?? null,
            seoDescRu: body.seoDescRu ?? null,
            seoDescKk: body.seoDescKk ?? null,
          },
        });

        await writeRelations(tx, created.id, body);

        return tx.product.findUniqueOrThrow({
          where: { id: created.id },
          include: productDetailInclude,
        });
      });

      audit(request, { entity: 'product', entityId: product.id, action: 'create' });
      reply.code(201);
      return toAdminProduct(product);
    },
  );

  app.put(
    '/products/:id',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:catalog'],
        summary: 'Полное обновление товара',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: productBodySchema,
        response: { 200: listItemSchema },
      },
    },
    async (request) => {
      const body = request.body;
      const existing = await prisma.product.findUnique({ where: { id: request.params.id } });
      if (!existing) throw notFound('Товар');

      const slug = body.slug?.trim() || existing.slug;
      if (slug !== existing.slug) {
        const clash = await prisma.product.findUnique({ where: { slug } });
        if (clash) throw conflict(`Товар с адресом «${slug}» уже есть`);
      }
      if (body.type === 'BUNDLE' && body.bundleItems.length === 0) {
        throw badRequest('В наборе должна быть хотя бы одна позиция');
      }
      if (body.bundleItems.some((item) => item.componentId === existing.id)) {
        throw badRequest('Набор не может включать сам себя');
      }

      const product = await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: existing.id },
          data: {
            slug,
            type: body.type,
            nameRu: body.nameRu,
            nameKk: body.nameKk,
            shortRu: body.shortRu ?? null,
            shortKk: body.shortKk ?? null,
            descriptionRu: body.descriptionRu ?? null,
            descriptionKk: body.descriptionKk ?? null,
            price: body.price,
            compareAtPrice: body.compareAtPrice ?? null,
            costPrice: body.costPrice ?? null,
            weightValue: body.weightValue,
            weightUnit: body.weightUnit,
            categoryId: body.categoryId ?? null,
            stockStatus: body.stockStatus,
            stockQty: body.stockQty ?? null,
            isActive: body.isActive,
            isFeatured: body.isFeatured,
            sortOrder: body.sortOrder,
            seoTitleRu: body.seoTitleRu ?? null,
            seoTitleKk: body.seoTitleKk ?? null,
            seoDescRu: body.seoDescRu ?? null,
            seoDescKk: body.seoDescKk ?? null,
          },
        });

        await writeRelations(tx, existing.id, body);

        return tx.product.findUniqueOrThrow({
          where: { id: existing.id },
          include: productDetailInclude,
        });
      });

      audit(request, {
        entity: 'product',
        entityId: product.id,
        action: 'update',
        diff: diffOf(existing as unknown as Record<string, unknown>, body),
      });

      return toAdminProduct(product);
    },
  );

  app.patch(
    '/products/bulk',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:catalog'],
        summary: 'Массовые правки: инлайн-цена, наличие, видимость, порядок',
        security: [{ bearerAuth: [] }],
        body: z.object({
          ids: z.array(z.string()).min(1).max(200),
          patch: z
            .object({
              price: z.number().int().min(0).optional(),
              costPrice: z.number().int().min(0).nullish(),
              isActive: z.boolean().optional(),
              isFeatured: z.boolean().optional(),
              stockStatus: z.enum(['IN_STOCK', 'LOW', 'OUT']).optional(),
              categoryId: z.string().nullish(),
            })
            .refine((patch) => Object.keys(patch).length > 0, 'Нечего менять'),
        }),
        response: { 200: z.object({ updated: z.number() }) },
      },
    },
    async (request) => {
      const { ids, patch } = request.body;
      const result = await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: {
          ...(patch.price === undefined ? {} : { price: patch.price }),
          ...(patch.costPrice === undefined ? {} : { costPrice: patch.costPrice }),
          ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
          ...(patch.isFeatured === undefined ? {} : { isFeatured: patch.isFeatured }),
          ...(patch.stockStatus === undefined ? {} : { stockStatus: patch.stockStatus }),
          ...(patch.categoryId === undefined ? {} : { categoryId: patch.categoryId }),
        },
      });

      audit(request, { entity: 'product', action: 'bulk', diff: { ids, patch } });
      return { updated: result.count };
    },
  );

  app.patch(
    '/products/reorder',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER', 'MANAGER')],
      schema: {
        tags: ['admin:catalog'],
        summary: 'Порядок товаров в каталоге (drag & drop)',
        security: [{ bearerAuth: [] }],
        body: z.object({ ids: z.array(z.string()).min(1).max(500) }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      await prisma.$transaction(
        request.body.ids.map((id, index) =>
          prisma.product.update({ where: { id }, data: { sortOrder: index * 10 } }),
        ),
      );
      audit(request, { entity: 'product', action: 'bulk', diff: { reorder: request.body.ids } });
      return { ok: true };
    },
  );

  app.delete(
    '/products/:id',
    {
      onRequest: [app.authenticate, app.requireRole('OWNER')],
      schema: {
        tags: ['admin:catalog'],
        summary: 'Удаление товара',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (request) => {
      const product = await prisma.product.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { partOfBundles: true, orderItems: true } } },
      });
      if (!product) throw notFound('Товар');

      if (product._count.partOfBundles > 0) {
        throw conflict('Позиция входит в наборы — сначала уберите её из них');
      }
      // В заказах остаётся снимок названия и цены, поэтому удалять безопасно.
      await prisma.product.delete({ where: { id: product.id } });

      audit(request, { entity: 'product', entityId: product.id, action: 'delete' });
      return { ok: true };
    },
  );
};

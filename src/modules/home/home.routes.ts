import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { getPublicSettings, publicSettingsSchema } from '../settings/settings.service.js';
import { productCardInclude, serializeProductCard } from '../catalog/catalog.serializers.js';
import { productCardSchema } from '../catalog/catalog.schemas.js';

const homeSectionSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'HERO',
    'COLLECTION',
    'BUNDLES',
    'CATEGORIES',
    'EDITORIAL',
    'BANNER',
    'STEPS',
    'FAQ',
    'CONTACTS',
  ]),
  /** Содержимое зависит от kind и целиком редактируется в конструкторе главной. */
  payload: z.record(z.string(), z.any()),
  sortOrder: z.number(),
  /** Товары подгружаются сервером для секций COLLECTION и BUNDLES. */
  products: z.array(productCardSchema).optional(),
});

const homeSchema = z.object({
  sections: z.array(homeSectionSchema),
  settings: publicSettingsSchema,
});

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/home',
    {
      schema: {
        tags: ['home'],
        summary: 'Секции главной страницы и публичные настройки одним запросом',
        response: { 200: homeSchema },
      },
    },
    async () => {
      const [sections, settings] = await Promise.all([
        prisma.homeSection.findMany({
          where: { isVisible: true },
          orderBy: { sortOrder: 'asc' },
        }),
        getPublicSettings(),
      ]);

      // Секции с товарами наполняем здесь, чтобы витрина обошлась одним запросом.
      const collectionSlugs = sections
        .filter((section) => section.kind === 'COLLECTION')
        .map((section) => (section.payload as { collectionSlug?: string }).collectionSlug)
        .filter((slug): slug is string => Boolean(slug));

      const collections = collectionSlugs.length
        ? await prisma.collection.findMany({
            where: { slug: { in: collectionSlugs }, isVisible: true },
            include: {
              products: {
                orderBy: { sortOrder: 'asc' },
                include: { product: { include: productCardInclude } },
              },
            },
          })
        : [];

      const bySlug = new Map(collections.map((collection) => [collection.slug, collection]));

      const needsBundles = sections.some((section) => section.kind === 'BUNDLES');
      const bundles = needsBundles
        ? await prisma.product.findMany({
            where: { isActive: true, type: 'BUNDLE' },
            include: productCardInclude,
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          })
        : [];

      return {
        settings,
        sections: sections.map((section) => {
          const base = {
            id: section.id,
            kind: section.kind,
            payload: section.payload as Record<string, unknown>,
            sortOrder: section.sortOrder,
          };

          if (section.kind === 'BUNDLES') {
            return { ...base, products: bundles.map(serializeProductCard) };
          }

          if (section.kind === 'COLLECTION') {
            const slug = (section.payload as { collectionSlug?: string }).collectionSlug;
            const collection = slug ? bySlug.get(slug) : undefined;
            return {
              ...base,
              products:
                collection?.products
                  .filter((row) => row.product.isActive)
                  .map((row) => serializeProductCard(row.product)) ?? [],
            };
          }

          return base;
        }),
      };
    },
  );

  app.get(
    '/settings/public',
    {
      schema: {
        tags: ['home'],
        summary: 'Контакты, доставка, бренд — всё, что нужно шапке и подвалу',
        response: { 200: publicSettingsSchema },
      },
    },
    getPublicSettings,
  );
};

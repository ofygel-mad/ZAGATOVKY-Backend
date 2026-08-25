import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import {
  categorySchema,
  collectionSchema,
  productDetailSchema,
  productListQuerySchema,
  productListSchema,
} from './catalog.schemas.js';
import {
  productCardInclude,
  productDetailInclude,
  serializeCategory,
  serializeProductCard,
  serializeProductDetail,
} from './catalog.serializers.js';

const orderByFor = (sort: string): Prisma.ProductOrderByWithRelationInput[] => {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }];
    case 'price_desc':
      return [{ price: 'desc' }];
    case 'name':
      return [{ nameRu: 'asc' }];
    case 'new':
      return [{ createdAt: 'desc' }];
    default:
      return [{ sortOrder: 'asc' }, { createdAt: 'asc' }];
  }
};

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/categories',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Категории каталога с числом активных товаров',
        response: { 200: z.array(categorySchema) },
      },
    },
    async () => {
      const categories = await prisma.category.findMany({
        where: { isVisible: true },
        include: { image: true, _count: { select: { products: { where: { isActive: true } } } } },
        orderBy: [{ sortOrder: 'asc' }, { nameRu: 'asc' }],
      });

      return categories.map((category) => serializeCategory(category, category._count.products));
    },
  );

  app.get(
    '/products',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Список товаров с фильтрами',
        querystring: productListQuerySchema,
        response: { 200: productListSchema },
      },
    },
    async (request) => {
      const { category, search, type, featured, sort, limit, offset } = request.query;

      const where: Prisma.ProductWhereInput = {
        isActive: true,
        ...(category ? { category: { slug: category } } : {}),
        ...(type ? { type } : {}),
        ...(featured === undefined ? {} : { isFeatured: featured }),
        ...(search
          ? {
              OR: [
                { nameRu: { contains: search, mode: 'insensitive' } },
                { nameKk: { contains: search, mode: 'insensitive' } },
                { shortRu: { contains: search, mode: 'insensitive' } },
                { shortKk: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: productCardInclude,
          orderBy: orderByFor(sort),
          take: limit,
          skip: offset,
        }),
        prisma.product.count({ where }),
      ]);

      return { items: items.map(serializeProductCard), total };
    },
  );

  app.get(
    '/products/:slug',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Карточка товара: все фото, описание, состав набора',
        params: z.object({ slug: z.string() }),
        response: { 200: productDetailSchema },
      },
    },
    async (request) => {
      const product = await prisma.product.findFirst({
        where: { slug: request.params.slug, isActive: true },
        include: productDetailInclude,
      });

      if (!product) throw notFound('Товар');
      return serializeProductDetail(product);
    },
  );

  app.get(
    '/collections/:slug',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Подборка товаров («Хиты», «Новинки» и т.д.)',
        params: z.object({ slug: z.string() }),
        response: { 200: collectionSchema },
      },
    },
    async (request) => {
      const collection = await prisma.collection.findFirst({
        where: { slug: request.params.slug, isVisible: true },
        include: {
          products: {
            orderBy: { sortOrder: 'asc' },
            include: { product: { include: productCardInclude } },
          },
        },
      });

      if (!collection) throw notFound('Подборка');

      return {
        id: collection.id,
        slug: collection.slug,
        title: { ru: collection.titleRu, kk: collection.titleKk },
        subtitle: { ru: collection.subtitleRu, kk: collection.subtitleKk },
        products: collection.products
          .filter((row) => row.product.isActive)
          .map((row) => serializeProductCard(row.product)),
      };
    },
  );
};

import { z } from 'zod';
import { booleanQuery } from '../../lib/query.js';

/**
 * Двуязычный текст. Сервер всегда отдаёт обе версии, а витрина выбирает нужную
 * на клиенте — переключение языка мгновенное, без похода в сеть.
 */
export const localizedSchema = z.object({
  ru: z.string(),
  kk: z.string(),
});

export const localizedNullableSchema = z.object({
  ru: z.string().nullable(),
  kk: z.string().nullable(),
});

export const imageSchema = z.object({
  id: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  lqip: z.string().nullable(),
  alt: localizedNullableSchema,
});

export const badgeSchema = z.object({
  code: z.string(),
  label: localizedSchema,
  tone: z.enum(['GOLD', 'TEAL', 'STONE']),
  icon: z.string().nullable(),
});

export const weightSchema = z.object({
  value: z.number(),
  unit: z.enum(['G', 'ML', 'PORTION', 'PCS']),
});

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedSchema,
  description: localizedNullableSchema,
  image: imageSchema.nullable(),
  productCount: z.number().optional(),
});

export const productCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  type: z.enum(['SIMPLE', 'BUNDLE']),
  name: localizedSchema,
  short: localizedNullableSchema,
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  weight: weightSchema,
  stockStatus: z.enum(['IN_STOCK', 'LOW', 'OUT']),
  isFeatured: z.boolean(),
  category: z
    .object({ id: z.string(), slug: z.string(), name: localizedSchema })
    .nullable(),
  badges: z.array(badgeSchema),
  image: imageSchema.nullable(),
});

export const bundleComponentSchema = z.object({
  qty: z.number(),
  product: productCardSchema,
});

export const productDetailSchema = productCardSchema.extend({
  description: localizedNullableSchema,
  seoTitle: localizedNullableSchema,
  seoDescription: localizedNullableSchema,
  images: z.array(imageSchema),
  /** Состав набора. Для обычного товара — пустой массив. */
  bundleItems: z.array(bundleComponentSchema),
  /** Сумма цен компонентов набора — витрина показывает выгоду. Null для обычного товара. */
  componentsTotal: z.number().nullable(),
});

export const collectionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: localizedSchema,
  subtitle: localizedNullableSchema,
  products: z.array(productCardSchema),
});

export const productListQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  type: z.enum(['SIMPLE', 'BUNDLE']).optional(),
  featured: booleanQuery.optional(),
  sort: z.enum(['default', 'price_asc', 'price_desc', 'name', 'new']).default('default'),
  limit: z.coerce.number().int().min(1).max(100).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

export const productListSchema = z.object({
  items: z.array(productCardSchema),
  total: z.number(),
});

export type Localized = z.infer<typeof localizedSchema>;
export type ProductCard = z.infer<typeof productCardSchema>;
export type ProductDetail = z.infer<typeof productDetailSchema>;

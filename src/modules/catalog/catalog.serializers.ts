import type { Prisma } from '@prisma/client';
import type { ProductCard, ProductDetail } from './catalog.schemas.js';

/** Набор include, дающий всё необходимое для карточки товара. */
export const productCardInclude = {
  category: true,
  badges: { include: { badge: true } },
  images: { include: { asset: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ProductInclude;

export const productDetailInclude = {
  ...productCardInclude,
  bundleItems: {
    orderBy: { sortOrder: 'asc' },
    include: { component: { include: productCardInclude } },
  },
} satisfies Prisma.ProductInclude;

type ProductWithCard = Prisma.ProductGetPayload<{ include: typeof productCardInclude }>;
type ProductWithDetail = Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>;
type ImageRow = ProductWithCard['images'][number];

const serializeImage = (row: ImageRow) => ({
  id: row.asset.id,
  url: row.asset.url,
  width: row.asset.width,
  height: row.asset.height,
  lqip: row.asset.lqip,
  alt: { ru: row.altRu, kk: row.altKk },
});

export const serializeProductCard = (product: ProductWithCard): ProductCard => ({
  id: product.id,
  slug: product.slug,
  type: product.type,
  name: { ru: product.nameRu, kk: product.nameKk },
  short: { ru: product.shortRu, kk: product.shortKk },
  price: product.price,
  compareAtPrice: product.compareAtPrice,
  weight: { value: product.weightValue, unit: product.weightUnit },
  portions: product.portions,
  stockStatus: product.stockStatus,
  isFeatured: product.isFeatured,
  category: product.category
    ? {
        id: product.category.id,
        slug: product.category.slug,
        name: { ru: product.category.nameRu, kk: product.category.nameKk },
      }
    : null,
  badges: product.badges.map(({ badge }) => ({
    code: badge.code,
    label: { ru: badge.labelRu, kk: badge.labelKk },
    tone: badge.tone,
    icon: badge.icon,
  })),
  image: product.images[0] ? serializeImage(product.images[0]) : null,
});

export const serializeProductDetail = (product: ProductWithDetail): ProductDetail => {
  const bundleItems = product.bundleItems.map((item) => ({
    qty: item.qty,
    product: serializeProductCard(item.component),
  }));

  return {
    ...serializeProductCard(product),
    description: { ru: product.descriptionRu, kk: product.descriptionKk },
    seoTitle: { ru: product.seoTitleRu, kk: product.seoTitleKk },
    seoDescription: { ru: product.seoDescRu, kk: product.seoDescKk },
    images: product.images.map(serializeImage),
    bundleItems,
    componentsTotal: bundleItems.length
      ? bundleItems.reduce((sum, item) => sum + item.product.price * item.qty, 0)
      : null,
  };
};

type CategoryRow = Prisma.CategoryGetPayload<{ include: { image: true } }>;

export const serializeCategory = (category: CategoryRow, productCount?: number) => ({
  id: category.id,
  slug: category.slug,
  name: { ru: category.nameRu, kk: category.nameKk },
  description: { ru: category.descriptionRu, kk: category.descriptionKk },
  image: category.image
    ? {
        id: category.image.id,
        url: category.image.url,
        width: category.image.width,
        height: category.image.height,
        lqip: category.image.lqip,
        alt: { ru: null, kk: null },
      }
    : null,
  ...(productCount === undefined ? {} : { productCount }),
});

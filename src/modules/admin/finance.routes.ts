import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { booleanQuery } from '../../lib/query.js';

/**
 * Финансовый отчёт. Считается по снимкам в OrderItem, а не по текущему каталогу —
 * поэтому прошлые периоды не переписываются при смене цен.
 *
 * Себестоимость необязательна. Если её нет ни у одной позиции, отчёт всё равно
 * показывает выручку, а прибыль отдаётся как null — фронт объясняет, чего не хватает,
 * вместо того чтобы молча показать прибыль, равную выручке.
 */

const bucketSchema = z.object({
  key: z.string(),
  orders: z.number(),
  /** Деньги за товары, без доставки */
  goods: z.number(),
  delivery: z.number(),
  revenue: z.number(),
  /** Себестоимость по позициям, где она известна */
  cost: z.number(),
  /** goods − cost. null, если себестоимость не заполнена ни у одной позиции периода */
  profit: z.number().nullable(),
});

const responseSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: bucketSchema,
  payment: z.object({
    paidCount: z.number(),
    paidAmount: z.number(),
    unpaidCount: z.number(),
    unpaidAmount: z.number(),
  }),
  /** Насколько отчёту можно верить: доля выручки, закрытой себестоимостью */
  coverage: z.object({
    positions: z.number(),
    positionsWithCost: z.number(),
    goodsWithCost: z.number(),
    goodsWithoutCost: z.number(),
    /** Названия позиций без себестоимости — по ним и надо дозаполнить каталог */
    missing: z.array(z.object({ nameRu: z.string(), qty: z.number(), goods: z.number() })),
  }),
  byDay: z.array(bucketSchema),
  byProduct: z.array(
    bucketSchema.extend({ qty: z.number(), hasCost: z.boolean() }),
  ),
  byStatus: z.array(z.object({ status: z.string(), orders: z.number(), revenue: z.number() })),
});

/** Локальная дата в виде YYYY-MM-DD — по ней группируем дни. */
const dayKey = (date: Date) => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
};

const emptyBucket = (key: string) => ({
  key,
  orders: 0,
  goods: 0,
  delivery: 0,
  revenue: 0,
  cost: 0,
  costKnown: false,
});

type Bucket = ReturnType<typeof emptyBucket>;

const finish = (bucket: Bucket) => ({
  key: bucket.key,
  orders: bucket.orders,
  goods: bucket.goods,
  delivery: bucket.delivery,
  revenue: bucket.revenue,
  cost: bucket.cost,
  profit: bucket.costKnown ? bucket.goods - bucket.cost : null,
});

export const adminFinanceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/finance',
    {
      schema: {
        tags: ['admin:system'],
        summary: 'Отчёт по продажам, выручке и прибыли',
        description:
          'Отменённые, архивные и тестовые заказы в отчёт не входят. ' +
          'Прибыль = деньги за товары минус себестоимость; доставка в прибыль не идёт.',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          /** Включительно, локальная дата YYYY-MM-DD. По умолчанию — последние 30 дней. */
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          /** Считать только заказы с отметкой об оплате */
          paidOnly: booleanQuery.default(false),
        }),
        response: { 200: responseSchema },
      },
    },
    async (request) => {
      const now = new Date();
      const toDate = request.query.to
        ? new Date(`${request.query.to}T23:59:59.999`)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const fromDate = request.query.from
        ? new Date(`${request.query.from}T00:00:00.000`)
        : new Date(toDate.getTime() - 29 * 86_400_000);
      fromDate.setHours(0, 0, 0, 0);

      const where: Prisma.OrderWhereInput = {
        isTest: false,
        archivedAt: null,
        status: { not: 'CANCELLED' },
        createdAt: { gte: fromDate, lte: toDate },
        ...(request.query.paidOnly ? { isPaid: true } : {}),
      };

      const orders = await prisma.order.findMany({
        where,
        select: {
          createdAt: true,
          status: true,
          deliveryFee: true,
          isPaid: true,
          total: true,
          items: { select: { nameRu: true, price: true, qty: true, costPrice: true } },
        },
      });

      const totals = emptyBucket('total');
      const days = new Map<string, Bucket>();
      const products = new Map<string, Bucket & { qty: number }>();
      const statuses = new Map<string, { orders: number; revenue: number }>();
      const missing = new Map<string, { nameRu: string; qty: number; goods: number }>();

      let positions = 0;
      let positionsWithCost = 0;
      let goodsWithCost = 0;
      let goodsWithoutCost = 0;
      let paidCount = 0;
      let paidAmount = 0;
      let unpaidCount = 0;
      let unpaidAmount = 0;

      for (const order of orders) {
        const key = dayKey(order.createdAt);
        const day = days.get(key) ?? emptyBucket(key);
        days.set(key, day);

        const goods = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);

        for (const bucket of [totals, day]) {
          bucket.orders += 1;
          bucket.goods += goods;
          bucket.delivery += order.deliveryFee;
          bucket.revenue += order.total;
        }

        const statusRow = statuses.get(order.status) ?? { orders: 0, revenue: 0 };
        statusRow.orders += 1;
        statusRow.revenue += order.total;
        statuses.set(order.status, statusRow);

        if (order.isPaid) {
          paidCount += 1;
          paidAmount += order.total;
        } else {
          unpaidCount += 1;
          unpaidAmount += order.total;
        }

        for (const item of order.items) {
          const itemGoods = item.price * item.qty;
          positions += item.qty;

          const product =
            products.get(item.nameRu) ?? { ...emptyBucket(item.nameRu), qty: 0 };
          product.qty += item.qty;
          product.goods += itemGoods;
          product.revenue += itemGoods;
          product.orders += 1;
          products.set(item.nameRu, product);

          if (item.costPrice === null) {
            goodsWithoutCost += itemGoods;
            const row = missing.get(item.nameRu) ?? { nameRu: item.nameRu, qty: 0, goods: 0 };
            row.qty += item.qty;
            row.goods += itemGoods;
            missing.set(item.nameRu, row);
            continue;
          }

          const itemCost = item.costPrice * item.qty;
          positionsWithCost += item.qty;
          goodsWithCost += itemGoods;

          for (const bucket of [totals, day, product]) {
            bucket.cost += itemCost;
            bucket.costKnown = true;
          }
        }
      }

      return {
        from: dayKey(fromDate),
        to: dayKey(toDate),
        totals: finish(totals),
        payment: { paidCount, paidAmount, unpaidCount, unpaidAmount },
        coverage: {
          positions,
          positionsWithCost,
          goodsWithCost,
          goodsWithoutCost,
          missing: [...missing.values()].sort((a, b) => b.goods - a.goods).slice(0, 12),
        },
        byDay: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)).map(finish),
        byProduct: [...products.values()]
          .sort((a, b) => b.goods - a.goods)
          .slice(0, 30)
          .map((product) => ({
            ...finish(product),
            qty: product.qty,
            hasCost: product.costKnown,
          })),
        byStatus: [...statuses.entries()].map(([status, row]) => ({ status, ...row })),
      };
    },
  );
};

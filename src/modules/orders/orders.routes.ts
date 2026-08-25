import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { getPublicSettings } from '../settings/settings.service.js';
import {
  buildChatLink,
  buildOrderMessage,
  calculateDeliveryFee,
  formatOrderNumber,
  formatWeight,
} from './orders.service.js';

const createOrderSchema = z.object({
  customerName: z.string().trim().min(2, 'Укажите имя').max(120),
  phone: z
    .string()
    .trim()
    .min(10, 'Укажите телефон')
    .max(32)
    .regex(/^[\d\s+()-]+$/, 'Телефон содержит недопустимые символы'),
  channel: z.enum(['WHATSAPP', 'TELEGRAM']).default('WHATSAPP'),
  customerType: z.enum(['PERSON', 'BUSINESS']).default('PERSON'),
  deliveryType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  address: z.string().trim().max(300).optional(),
  comment: z.string().trim().max(1000).optional(),
  locale: z.enum(['ru', 'kk']).default('ru'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .min(1, 'Корзина пуста')
    .max(50),
  /** Ловушка для ботов: настоящий пользователь это поле не видит и не заполняет. */
  website: z.string().max(0).optional(),
  /** Проставляется Playwright-прогонами, чтобы отделить тестовые заявки от реальных. */
  isTest: z.boolean().default(false),
});

const orderResponseSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  subtotal: z.number(),
  deliveryFee: z.number(),
  total: z.number(),
  /** Готовая ссылка в WhatsApp/Telegram с текстом заказа. */
  chatUrl: z.string(),
  message: z.string(),
  /** Ссылка Kaspi Pay на удалённую оплату — пусто, если способ выключен */
  paymentUrl: z.string().nullable(),
});

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/orders',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '10 minutes' },
      },
      schema: {
        tags: ['orders'],
        summary: 'Оформление заказа: сохраняет заявку и отдаёт ссылку в чат',
        body: createOrderSchema,
        response: { 201: orderResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;

      if (body.website) throw badRequest('Некорректный запрос');
      if (body.deliveryType === 'DELIVERY' && !body.address) {
        throw badRequest('Для доставки нужен адрес');
      }

      const settings = await getPublicSettings();

      const productIds = [...new Set(body.items.map((item) => item.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });

      if (products.length !== productIds.length) {
        throw badRequest('Часть товаров больше недоступна — обновите корзину');
      }

      const byId = new Map(products.map((product) => [product.id, product]));

      // Цены берём из БД, а не из тела запроса — клиенту доверять нельзя.
      const items = body.items.map((item) => {
        const product = byId.get(item.productId)!;
        return {
          productId: product.id,
          nameRu: product.nameRu,
          nameKk: product.nameKk,
          price: product.price,
          qty: item.qty,
          weightLabel: formatWeight(product.weightValue, product.weightUnit),
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

      if (body.deliveryType === 'DELIVERY' && subtotal < settings.delivery.minOrder) {
        throw badRequest(
          `Минимальная сумма заказа с доставкой — ${settings.delivery.minOrder} тг`,
        );
      }

      const deliveryFee = calculateDeliveryFee(subtotal, body.deliveryType, settings.delivery);
      const total = subtotal + deliveryFee;

      const order = await prisma.order.create({
        data: {
          customerName: body.customerName,
          phone: body.phone,
          channel: body.channel,
          customerType: body.customerType,
          deliveryType: body.deliveryType,
          address: body.address ?? null,
          comment: body.comment ?? null,
          subtotal,
          deliveryFee,
          total,
          isTest: body.isTest,
          items: { create: items },
          events: { create: { toStatus: 'NEW', note: 'Заявка с витрины' } },
        },
      });

      const number = formatOrderNumber(order.seq);
      const message = buildOrderMessage(
        {
          number,
          customerName: order.customerName,
          deliveryType: order.deliveryType,
          address: order.address,
          comment: order.comment,
          subtotal,
          deliveryFee,
          total,
          items: items.map((item) => ({
            name: { ru: item.nameRu, kk: item.nameKk },
            qty: item.qty,
            price: item.price,
            weightLabel: item.weightLabel,
          })),
        },
        body.locale,
      );

      reply.code(201);
      return {
        id: order.id,
        number,
        status: order.status,
        subtotal,
        deliveryFee,
        total,
        chatUrl: buildChatLink(order.channel, settings.contacts, message),
        message,
        paymentUrl:
          settings.payment.kaspiEnabled && settings.payment.kaspiLink
            ? settings.payment.kaspiLink
            : null,
      };
    },
  );
};

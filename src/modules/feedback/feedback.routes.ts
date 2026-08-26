import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { config } from '../../config.js';

/**
 * Публичный приём сообщений с витрины: пожелания по ассортименту, отзывы, вопросы.
 * Заказом это не становится — только поводом написать человеку.
 *
 * Защита та же, что у заказов: ловушка для ботов и ограничение частоты. Ответ
 * намеренно не содержит идентификатора — по нему нечего запрашивать снаружи.
 */

export const feedbackKinds = ['WISH', 'REVIEW', 'QUESTION'] as const;

const createSchema = z.object({
  kind: z.enum(feedbackKinds).default('WISH'),
  name: z.string().trim().min(2, 'Как к вам обращаться?').max(120, 'Имя слишком длинное'),
  /** Необязателен: человек может просто оставить пожелание и не ждать ответа */
  contact: z.string().trim().max(120, 'Контакт слишком длинный').optional(),
  message: z
    .string()
    .trim()
    .min(5, 'Напишите чуть подробнее')
    .max(2000, 'Сообщение слишком длинное'),
  locale: z.enum(['ru', 'kk']).default('ru'),
  /** Ловушка для ботов: настоящий человек это поле не видит и не заполняет */
  website: z.string().max(0).optional(),
  /** Проставляется прогонами Playwright, чтобы они не мусорили в кабинете */
  isTest: z.boolean().default(false),
});

export const feedbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/feedback',
    {
      config: {
        // Вне продакшена порог поднят: прогон тестов отправляет несколько сообщений
        // подряд с одного адреса и упирался бы в лимит вместо поиска ошибок.
        rateLimit: config.isProduction
          ? { max: 5, timeWindow: '10 minutes' }
          : { max: 200, timeWindow: '10 minutes' },
      },
      schema: {
        tags: ['feedback'],
        summary: 'Сообщение с витрины: пожелание, отзыв или вопрос',
        body: createSchema,
        response: { 201: z.object({ ok: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (body.website) throw badRequest('Некорректный запрос');

      await prisma.feedback.create({
        data: {
          kind: body.kind,
          name: body.name,
          contact: body.contact || null,
          message: body.message,
          locale: body.locale,
          isTest: body.isTest,
        },
      });

      reply.code(201);
      return { ok: true };
    },
  );
};

import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

type AuditInput = {
  entity: string;
  entityId?: string | null;
  action: 'create' | 'update' | 'delete' | 'login' | 'bulk';
  diff?: unknown;
};

/**
 * Журнал действий. Пишется «в фоне»: сбой записи в журнал не должен
 * ронять уже выполненную операцию — поэтому ошибки только логируются.
 */
export const audit = (request: FastifyRequest, input: AuditInput) => {
  void prisma.auditLog
    .create({
      data: {
        userId: request.authUser?.id ?? null,
        entity: input.entity,
        entityId: input.entityId ?? null,
        action: input.action,
        diff: (input.diff ?? undefined) as never,
        ip: request.ip,
      },
    })
    .catch((error: unknown) => request.log.warn({ err: error }, 'Не удалось записать в журнал'));
};

/** Показывает только реально изменившиеся поля — журнал остаётся читаемым. */
export const diffOf = <T extends Record<string, unknown>>(before: T, after: Partial<T>) => {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    changes[key] = { from: before[key], to: value };
  }
  return Object.keys(changes).length ? changes : undefined;
};

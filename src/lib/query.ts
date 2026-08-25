import { z } from 'zod';

/**
 * Флаг в строке запроса.
 *
 * `z.coerce.boolean()` здесь непригоден: он делает Boolean("false") — то есть `true`.
 * Из-за этого любой явно переданный `?flag=false` включал фильтр вместо того, чтобы
 * его выключить, и отчёты молча считали не то, что просили.
 */
export const booleanQuery = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['true', '1', 'yes', 'on'].includes(value.toLowerCase()),
  );

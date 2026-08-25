import { AppError } from '../../lib/errors.js';

/**
 * Защита от подбора пароля.
 *
 * Считаем только НЕУДАЧНЫЕ попытки: перебор — это именно они. Успешные входы
 * ограничивать почти нет смысла, зато легко испортить жизнь команде, работающей
 * из одного офиса, и автотестам. Ключ — пара «IP + почта», чтобы атака на один
 * аккаунт не блокировала вход остальным с того же адреса.
 */

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60_000;

type Entry = { failures: number; firstAt: number };

const attempts = new Map<string, Entry>();

const keyOf = (ip: string, email: string) => `${ip}|${email.toLowerCase()}`;

/** Чистим просроченные записи, чтобы карта не росла бесконечно. */
const sweep = () => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.firstAt > WINDOW_MS) attempts.delete(key);
  }
};

setInterval(sweep, WINDOW_MS).unref();

export const assertNotLocked = (ip: string, email: string) => {
  const entry = attempts.get(keyOf(ip, email));
  if (!entry) return;

  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(keyOf(ip, email));
    return;
  }

  if (entry.failures >= MAX_FAILURES) {
    const minutes = Math.ceil((WINDOW_MS - (Date.now() - entry.firstAt)) / 60_000);
    throw new AppError(
      429,
      `Слишком много неудачных попыток. Попробуйте через ${minutes} мин.`,
      'TOO_MANY_ATTEMPTS',
    );
  }
};

export const registerFailure = (ip: string, email: string) => {
  const key = keyOf(ip, email);
  const entry = attempts.get(key);

  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { failures: 1, firstAt: Date.now() });
    return;
  }

  entry.failures += 1;
};

export const clearFailures = (ip: string, email: string) => {
  attempts.delete(keyOf(ip, email));
};

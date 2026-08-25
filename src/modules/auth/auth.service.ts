import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config.js';

export const REFRESH_COOKIE = 'zg_refresh';

export const hashPassword = (password: string) => argon2.hash(password);
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

/** В БД лежит только хеш refresh-токена — утечка дампа не даёт войти. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const ttlToMs = (ttl: string) => {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return value * factor;
};

export const issueRefreshToken = async (
  userId: string,
  meta: { userAgent?: string; ip?: string },
) => {
  const token = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + ttlToMs(config.JWT_REFRESH_TTL));

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 250),
      ip: meta.ip,
    },
  });

  return { token, expiresAt };
};

/**
 * Окно, в течение которого уже отозванный токен всё ещё принимается.
 *
 * Токены ротируются: каждый /refresh гасит предъявленный и выдаёт новый.
 * Но две вкладки, открытые одновременно, обращаются к /refresh с одной и той же
 * кукой — без этого окна вторая получала бы 401 и выкидывала пользователя.
 * Токен, отозванный давно, по-прежнему отвергается: это признак кражи куки.
 */
const REUSE_GRACE_MS = 30_000;

export const consumeRefreshToken = async (token: string) => {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!row || row.expiresAt < new Date() || !row.user.isActive) return null;

  if (row.revokedAt && Date.now() - row.revokedAt.getTime() > REUSE_GRACE_MS) return null;

  if (!row.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
  }

  return row.user;
};

export const revokeRefreshToken = (token: string) =>
  prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const setRefreshCookie = (reply: FastifyReply, token: string, expiresAt: Date) => {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Админка и API живут на разных доменах — иначе браузер не отправит куку.
    sameSite: config.isProduction ? 'none' : 'lax',
    secure: config.isProduction,
    path: '/api/v1/admin/auth',
    expires: expiresAt,
    signed: false,
  });
};

export const clearRefreshCookie = (reply: FastifyReply) => {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/admin/auth' });
};

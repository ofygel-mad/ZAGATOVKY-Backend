import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

export const prisma = new PrismaClient({
  log: config.isDevelopment ? ['warn', 'error'] : ['error'],
});

export type { Prisma } from '@prisma/client';

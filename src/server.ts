import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';

const start = async () => {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Получен ${signal}, останавливаюсь`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`Swagger: http://localhost:${config.PORT}/docs`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();

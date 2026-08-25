import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { AppError, badRequest } from '../../lib/errors.js';

/** Максимальная сторона исходника: фото с телефона режем до разумного размера. */
const MAX_EDGE = 2000;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic'];

let client: S3Client | null = null;

const getClient = () => {
  if (!config.storage.enabled) {
    throw new AppError(
      503,
      'Хранилище фото не настроено: заполните переменные R2_* в окружении бэкенда',
      'STORAGE_DISABLED',
    );
  }
  client ??= new S3Client({
    region: 'auto',
    endpoint: config.storage.endpoint,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });
  return client;
};

export type ProcessedImage = {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  lqip: string;
};

/**
 * Приводит загруженное фото к единому виду: ограничивает размер, конвертирует в WebP
 * и делает крошечный размытый плейсхолдер (LQIP) для плавной загрузки на витрине.
 */
export const processAndUpload = async (
  buffer: Buffer,
  originalMime: string,
  folder = 'products',
): Promise<ProcessedImage> => {
  if (!ALLOWED_MIME.includes(originalMime)) {
    throw badRequest('Поддерживаются только JPEG, PNG, WebP, AVIF и HEIC');
  }

  const pipeline = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await pipeline.metadata();

  if (!meta.width || !meta.height) throw badRequest('Не удалось прочитать изображение');

  const resized = pipeline.resize({
    width: Math.min(meta.width, MAX_EDGE),
    height: Math.min(meta.height, MAX_EDGE),
    fit: 'inside',
    withoutEnlargement: true,
  });

  const { data, info } = await resized
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  // LQIP: 20px по ширине, сильное сжатие — весит порядка сотен байт
  const lqipBuffer = await sharp(data).resize(20).blur(1.2).webp({ quality: 40 }).toBuffer();
  const lqip = `data:image/webp;base64,${lqipBuffer.toString('base64')}`;

  const key = `${folder}/${new Date().getFullYear()}/${randomUUID()}.webp`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: key,
      Body: data,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return {
    key,
    url: `${config.storage.publicUrl}/${key}`,
    width: info.width,
    height: info.height,
    bytes: info.size,
    mime: 'image/webp',
    lqip,
  };
};

export const deleteObject = async (key: string) => {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }),
  );
};

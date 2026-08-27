import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config.js';

/**
 * Карта сайта, собранная из базы.
 *
 * Статический файл устаревал на первой же новой позиции: список товаров живёт
 * в кабинете, а не в репозитории. Здесь он всегда актуален, а витрина отдаёт эту
 * карту со своего домена — nginx проксирует /sitemap.xml сюда.
 *
 * Скрытые товары и невидимые категории в карту не попадают: приглашать поисковик
 * на страницу, которой нет на витрине, — прямой путь к ошибкам индексации.
 */

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

type Entry = { loc: string; lastmod?: Date; changefreq: string; priority: string };

const render = (entries: Entry[]) => {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
      return `  <url>
    <loc>${escape(entry.loc)}</loc>${lastmod}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

export const sitemapRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sitemap.xml', { schema: { hide: true } }, async (request, reply) => {
    // Адрес витрины, а не API: в карте должны стоять те ссылки, по которым
    // ходят люди. APP_URL как раз и есть публичный адрес магазина.
    const origin = config.APP_URL.replace(/\/+$/, '');

    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true, type: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.category.findMany({
        where: { isVisible: true },
        select: { slug: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const entries: Entry[] = [
      { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0' },
      { loc: `${origin}/catalog`, changefreq: 'daily', priority: '0.9' },
      { loc: `${origin}/catalog?type=BUNDLE`, changefreq: 'weekly', priority: '0.8' },
      ...categories.map((category) => ({
        loc: `${origin}/catalog?category=${category.slug}`,
        changefreq: 'weekly',
        priority: '0.7',
      })),
      ...products.map((product) => ({
        loc: `${origin}/product/${product.slug}`,
        lastmod: product.updatedAt,
        changefreq: 'weekly',
        // Наборы — то, ради чего к нам приходят: им приоритет выше обычных позиций
        priority: product.type === 'BUNDLE' ? '0.8' : '0.6',
      })),
    ];

    reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      // Час кэша: поисковики ходят сюда часто, а список меняется редко
      .header('Cache-Control', 'public, max-age=3600')
      .send(render(entries));
  });
};

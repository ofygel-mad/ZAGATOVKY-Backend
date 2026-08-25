import { PrismaClient, type Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { config } from '../src/config.js';

const prisma = new PrismaClient();

// ─── Категории ────────────────────────────────────────────────────────────────

const categories = [
  { slug: 'ovoshchi', nameRu: 'Овощи', nameKk: 'Көкөністер', sortOrder: 10,
    descriptionRu: 'Нарезано и взвешено под конкретное блюдо',
    descriptionKk: 'Нақты тағамға арнап туралған және өлшенген' },
  { slug: 'myaso', nameRu: 'Мясо', nameKk: 'Ет', sortOrder: 20,
    descriptionRu: 'Охлаждённое мясо в удобной порционной нарезке',
    descriptionKk: 'Ыңғайлы порциямен туралған салқындатылған ет' },
  { slug: 'dopolnenia', nameRu: 'Дополнения', nameKk: 'Қосымшалар', sortOrder: 30,
    descriptionRu: 'Масло, специи и всё, что доводит блюдо до вкуса',
    descriptionKk: 'Май, дәмдеуіштер және тағамның дәмін келтіретін бәрі' },
  { slug: 'nabory', nameRu: 'Готовые наборы', nameKk: 'Дайын жиынтықтар', sortOrder: 40,
    descriptionRu: 'Собранный комплект под одно блюдо — по цене выгоднее',
    descriptionKk: 'Бір тағамға жиналған жиынтық — бағасы тиімдірек' },
];

// ─── Товары (розничные цены из расчёта владельца) ─────────────────────────────

type SeedProduct = {
  slug: string;
  nameRu: string;
  nameKk: string;
  shortRu: string;
  shortKk: string;
  descriptionRu: string;
  descriptionKk: string;
  price: number;
  weightValue: number;
  weightUnit: 'G' | 'ML' | 'PORTION' | 'PCS';
  category: string;
  isFeatured?: boolean;
  badges?: string[];
  sortOrder: number;
};

const products: SeedProduct[] = [
  {
    slug: 'svekla',
    nameRu: 'Свекла', nameKk: 'Қызылша',
    shortRu: 'Очищена и нарезана соломкой', shortKk: 'Тазаланған және талшықтап туралған',
    descriptionRu: 'Свекла для борща и салатов: очищена, вымыта и нарезана соломкой. Готова отправиться в кастрюлю сразу из упаковки.',
    descriptionKk: 'Борщ пен салаттарға арналған қызылша: тазаланған, жуылған және талшықтап туралған. Қаптамадан бірден қазанға дайын.',
    price: 330, weightValue: 250, weightUnit: 'G', category: 'ovoshchi', sortOrder: 10,
    badges: ['fresh-cut'],
  },
  {
    slug: 'kapusta',
    nameRu: 'Капуста', nameKk: 'Қырыққабат',
    shortRu: 'Тонкая шинковка', shortKk: 'Жұқа туралған',
    descriptionRu: 'Белокочанная капуста тонкой шинковки — для борща, щей и тушения.',
    descriptionKk: 'Жұқа туралған ақ қырыққабат — борщқа, сорпаға және бұқтыруға.',
    price: 130, weightValue: 200, weightUnit: 'G', category: 'ovoshchi', sortOrder: 20,
    badges: ['fresh-cut'],
  },
  {
    slug: 'morkov',
    nameRu: 'Морковь', nameKk: 'Сәбіз',
    shortRu: 'Очищена и натёрта', shortKk: 'Тазаланған және үгітілген',
    descriptionRu: 'Морковь для зажарки: очищена и натёрта на крупной тёрке.',
    descriptionKk: 'Қуыруға арналған сәбіз: тазаланған және ірі үккіште үгітілген.',
    price: 130, weightValue: 100, weightUnit: 'G', category: 'ovoshchi', sortOrder: 30,
  },
  {
    slug: 'luk-repchatiy',
    nameRu: 'Лук репчатый', nameKk: 'Пияз',
    shortRu: 'Очищен и нарезан кубиком', shortKk: 'Тазаланған және текшелеп туралған',
    descriptionRu: 'Репчатый лук кубиком — без слёз и без запаха на руках.',
    descriptionKk: 'Текшелеп туралған пияз — көз жассыз және қолда иіссіз.',
    price: 110, weightValue: 100, weightUnit: 'G', category: 'ovoshchi', sortOrder: 40,
  },
  {
    slug: 'kartofel-narezanniy',
    nameRu: 'Картофель нарезанный', nameKk: 'Туралған картоп',
    shortRu: 'В вакууме, не темнеет', shortKk: 'Вакуумда, қараймайды',
    descriptionRu: 'Картофель, нарезанный кубиком и упакованный в вакуум — не темнеет и хранится дольше.',
    descriptionKk: 'Текшелеп туралып, вакуумға оралған картоп — қараймайды және ұзақ сақталады.',
    price: 470, weightValue: 800, weightUnit: 'G', category: 'ovoshchi', sortOrder: 50,
    isFeatured: true, badges: ['vacuum'],
  },
  {
    slug: 'kurinoe-file-kubikami',
    nameRu: 'Куриное филе кубиками', nameKk: 'Тауық еті текшелеп',
    shortRu: 'Охлаждённое, ровный кубик', shortKk: 'Салқындатылған, біркелкі текше',
    descriptionRu: 'Охлаждённое куриное филе, нарезанное ровным кубиком — жарится равномерно, ничего не пересыхает.',
    descriptionKk: 'Біркелкі текшелеп туралған салқындатылған тауық еті — біркелкі қуырылады, кеппейді.',
    price: 2270, weightValue: 400, weightUnit: 'G', category: 'myaso', sortOrder: 10,
    isFeatured: true, badges: ['hit'],
  },
  {
    slug: 'kartofel-dlya-zapekaniya',
    nameRu: 'Картофель для запекания', nameKk: 'Пісіруге арналған картоп',
    shortRu: 'Крупные дольки', shortKk: 'Ірі тілімдер',
    descriptionRu: 'Картофель крупными дольками — под духовку, с румяной корочкой.',
    descriptionKk: 'Ірі тілімделген картоп — духовкаға, қызғылт қабықпен.',
    price: 280, weightValue: 400, weightUnit: 'G', category: 'ovoshchi', sortOrder: 60,
  },
  {
    slug: 'maslo-rastitelnoe',
    nameRu: 'Масло растительное', nameKk: 'Өсімдік майы',
    shortRu: 'Порция под одно блюдо', shortKk: 'Бір тағамға порция',
    descriptionRu: 'Отмеренная порция растительного масла — ровно столько, сколько нужно.',
    descriptionKk: 'Өлшенген өсімдік майы — дәл қажет мөлшерде.',
    price: 80, weightValue: 40, weightUnit: 'ML', category: 'dopolnenia', sortOrder: 10,
  },
  {
    slug: 'specii-i-sol',
    nameRu: 'Специи и соль', nameKk: 'Дәмдеуіштер мен тұз',
    shortRu: 'Смесь под конкретное блюдо', shortKk: 'Нақты тағамға арналған қоспа',
    descriptionRu: 'Готовая смесь специй и соли, отмеренная на одну порцию блюда.',
    descriptionKk: 'Тағамның бір порциясына өлшенген дайын дәмдеуіш пен тұз қоспасы.',
    price: 80, weightValue: 1, weightUnit: 'PORTION', category: 'dopolnenia', sortOrder: 20,
  },
  {
    slug: 'govyadina-kubikami',
    nameRu: 'Говядина кубиками', nameKk: 'Сиыр еті текшелеп',
    shortRu: 'Охлаждённая, без жил', shortKk: 'Салқындатылған, сіңірсіз',
    descriptionRu: 'Охлаждённая говядина, зачищенная от жил и нарезанная кубиком — для тушения и плова.',
    descriptionKk: 'Сіңірден тазартылып, текшелеп туралған салқындатылған сиыр еті — бұқтыруға және палауға.',
    price: 3020, weightValue: 300, weightUnit: 'G', category: 'myaso', sortOrder: 20,
    badges: ['hit'],
  },
];

// ─── Комбо-наборы: самостоятельный товар со своей ценой ───────────────────────

type SeedBundle = SeedProduct & { items: { slug: string; qty: number }[] };

const bundles: SeedBundle[] = [
  {
    slug: 'borshchevoy-nabor',
    nameRu: 'Борщевой набор', nameKk: 'Борщ жиынтығы',
    shortRu: 'Всё для кастрюли борща', shortKk: 'Бір қазан борщқа керектің бәрі',
    descriptionRu: 'Свекла, капуста, морковь и лук — уже нарезаны в нужных пропорциях. Остаётся закинуть в бульон.',
    descriptionKk: 'Қызылша, қырыққабат, сәбіз және пияз — қажетті мөлшерде туралған. Сорпаға салсаңыз болды.',
    price: 640, weightValue: 650, weightUnit: 'G', category: 'nabory', sortOrder: 10,
    isFeatured: true, badges: ['bundle'],
    items: [
      { slug: 'svekla', qty: 1 },
      { slug: 'kapusta', qty: 1 },
      { slug: 'morkov', qty: 1 },
      { slug: 'luk-repchatiy', qty: 1 },
    ],
  },
  {
    slug: 'nabor-s-kuricey',
    nameRu: 'Набор с курицей', nameKk: 'Тауық етімен жиынтық',
    shortRu: 'Филе, картофель, масло и специи', shortKk: 'Ет, картоп, май және дәмдеуіш',
    descriptionRu: 'Куриное филе кубиками, картофель для запекания, отмеренное масло и специи — ужин на противне за 40 минут.',
    descriptionKk: 'Текшелеп туралған тауық еті, пісіруге арналған картоп, өлшенген май мен дәмдеуіш — 40 минутта дайын кешкі ас.',
    price: 2500, weightValue: 840, weightUnit: 'G', category: 'nabory', sortOrder: 20,
    isFeatured: true, badges: ['bundle', 'hit'],
    items: [
      { slug: 'kurinoe-file-kubikami', qty: 1 },
      { slug: 'kartofel-dlya-zapekaniya', qty: 1 },
      { slug: 'maslo-rastitelnoe', qty: 1 },
      { slug: 'specii-i-sol', qty: 1 },
    ],
  },
];

const badges = [
  { code: 'fresh-cut', labelRu: 'Свежий срез', labelKk: 'Жаңа тураған', tone: 'GOLD' as const },
  { code: 'hit', labelRu: 'Хит продаж', labelKk: 'Сатылым көшбасшысы', tone: 'GOLD' as const },
  { code: 'vacuum', labelRu: 'В вакууме', labelKk: 'Вакуумда', tone: 'TEAL' as const },
  { code: 'bundle', labelRu: 'Готовый набор', labelKk: 'Дайын жиынтық', tone: 'TEAL' as const },
];

const homeSections: { kind: Prisma.HomeSectionCreateInput['kind']; sortOrder: number; payload: Prisma.InputJsonValue }[] = [
  {
    kind: 'HERO', sortOrder: 10,
    payload: {
      eyebrow: { ru: 'Заготовки для дома и заведений', kk: 'Үй мен мекемелерге дайындамалар' },
      title: { ru: 'Нарезано, взвешено,\nупаковано', kk: 'Туралған, өлшенген,\nоралған' },
      subtitle: {
        ru: 'Мы делаем скучную часть готовки за вас. Вам остаётся достать из упаковки и поставить на огонь.',
        kk: 'Пісірудің қызықсыз бөлігін біз жасаймыз. Сізге қаптамадан алып, отқа қою ғана қалады.',
      },
      primaryCta: { ru: 'Смотреть каталог', kk: 'Каталогты қарау', href: '/catalog' },
      secondaryCta: { ru: 'Как это работает', kk: 'Бұл қалай жұмыс істейді', href: '#steps' },
    },
  },
  {
    kind: 'CATEGORIES', sortOrder: 20,
    payload: {
      title: { ru: 'Выберите категорию', kk: 'Санатты таңдаңыз' },
      subtitle: { ru: 'Овощи, мясо и всё остальное — уже подготовлено', kk: 'Көкөністер, ет және басқасы — бәрі дайын' },
    },
  },
  {
    kind: 'BUNDLES', sortOrder: 30,
    payload: {
      title: { ru: 'Готовые наборы', kk: 'Дайын жиынтықтар' },
      subtitle: {
        ru: 'Комплект под конкретное блюдо — выгоднее, чем брать по отдельности',
        kk: 'Нақты тағамға арналған жиынтық — бөлек алғаннан тиімдірек',
      },
    },
  },
  {
    kind: 'COLLECTION', sortOrder: 40,
    payload: {
      collectionSlug: 'hity',
      title: { ru: 'Чаще всего берут', kk: 'Жиі алынады' },
      subtitle: { ru: 'Позиции, которые повторяют из заказа в заказ', kk: 'Тапсырыстан тапсырысқа қайталанатын позициялар' },
    },
  },
  {
    kind: 'STEPS', sortOrder: 50,
    payload: {
      anchor: 'steps',
      title: { ru: 'Как это работает', kk: 'Бұл қалай жұмыс істейді' },
      steps: [
        { title: { ru: 'Собираете корзину', kk: 'Себет жинайсыз' },
          text: { ru: 'Выбираете заготовки или готовый набор под блюдо.', kk: 'Дайындама немесе тағамға арналған жиынтық таңдайсыз.' } },
        { title: { ru: 'Подтверждаем в чате', kk: 'Чатта растаймыз' },
          text: { ru: 'Пишете нам в WhatsApp — согласуем время и адрес доставки.', kk: 'WhatsApp-қа жазасыз — уақыт пен мекенжайды келісеміз.' } },
        { title: { ru: 'Режем в день доставки', kk: 'Жеткізу күні тураймыз' },
          text: { ru: 'Ничего не лежит на складе: нарезаем под ваш заказ.', kk: 'Қоймада ештеңе жатпайды: тапсырысыңызға арнап тураймыз.' } },
        { title: { ru: 'Готовите за 15 минут', kk: '15 минутта пісіресіз' },
          text: { ru: 'Достаёте, высыпаете, готовите. Без доски и мусора.', kk: 'Аласыз, төгесіз, пісіресіз. Тақтайсыз және қоқыссыз.' } },
      ],
    },
  },
  {
    kind: 'EDITORIAL', sortOrder: 60,
    payload: {
      title: { ru: 'Мы режем в день доставки', kk: 'Біз жеткізу күні тураймыз' },
      text: {
        ru: 'Никаких складских остатков: каждое утро мы получаем овощи и мясо, а нарезаем ровно под заказы этого дня. Поэтому заготовка приезжает к вам такой же, какой была бы, порежь вы её сами полчаса назад.',
        kk: 'Қойма қалдықтары жоқ: әр таң сайын көкөніс пен ет аламыз, тек сол күнгі тапсырыстарға арнап тураймыз. Сондықтан дайындама сізге жарты сағат бұрын өзіңіз тураған сияқты жетеді.',
      },
    },
  },
  {
    kind: 'FAQ', sortOrder: 70,
    payload: {
      title: { ru: 'Частые вопросы', kk: 'Жиі қойылатын сұрақтар' },
      items: [
        { q: { ru: 'Сколько хранится заготовка?', kk: 'Дайындама қанша сақталады?' },
          a: { ru: 'Овощи — до 3 суток в холодильнике, вакуумированный картофель — до 5 суток, мясо — 2 суток. Даты ставим на упаковке.', kk: 'Көкөністер — тоңазытқышта 3 тәулікке дейін, вакуумдалған картоп — 5 тәулікке дейін, ет — 2 тәулік. Күнін қаптамаға жазамыз.' } },
        { q: { ru: 'Работаете с заведениями?', kk: 'Мекемелермен жұмыс істейсіз бе?' },
          a: { ru: 'Да. Для кафе и столовых считаем объёмы и цену отдельно — напишите в WhatsApp.', kk: 'Иә. Кафе мен асханаларға көлем мен бағаны бөлек есептейміз — WhatsApp-қа жазыңыз.' } },
        { q: { ru: 'Как оплатить?', kk: 'Қалай төлеуге болады?' },
          a: { ru: 'Переводом или наличными при получении. Онлайн-оплаты на сайте пока нет.', kk: 'Аударыммен немесе қолма-қол алу кезінде. Сайтта онлайн төлем әзірге жоқ.' } },
      ],
    },
  },
  { kind: 'CONTACTS', sortOrder: 80, payload: { title: { ru: 'Написать нам', kk: 'Бізге жазыңыз' } } },
];

// ─── Запуск ───────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('Сидирую базу…');

  const owner = await prisma.user.upsert({
    where: { email: config.SEED_OWNER_EMAIL },
    update: {},
    create: {
      email: config.SEED_OWNER_EMAIL,
      passwordHash: await argon2.hash(config.SEED_OWNER_PASSWORD),
      name: 'Владелец',
      role: 'OWNER',
    },
  });
  console.log(`  владелец: ${owner.email}`);

  for (const badge of badges) {
    await prisma.badge.upsert({ where: { code: badge.code }, update: badge, create: badge });
  }

  const categoryIds = new Map<string, string>();
  for (const category of categories) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: category,
      create: category,
    });
    categoryIds.set(category.slug, row.id);
  }

  const badgeIds = new Map(
    (await prisma.badge.findMany()).map((badge) => [badge.code, badge.id]),
  );

  const upsertProduct = async (item: SeedProduct, type: 'SIMPLE' | 'BUNDLE') => {
    const data = {
      type,
      nameRu: item.nameRu,
      nameKk: item.nameKk,
      shortRu: item.shortRu,
      shortKk: item.shortKk,
      descriptionRu: item.descriptionRu,
      descriptionKk: item.descriptionKk,
      price: item.price,
      weightValue: item.weightValue,
      weightUnit: item.weightUnit,
      categoryId: categoryIds.get(item.category) ?? null,
      isFeatured: item.isFeatured ?? false,
      sortOrder: item.sortOrder,
    };

    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: data,
      create: { slug: item.slug, ...data },
    });

    await prisma.productBadge.deleteMany({ where: { productId: product.id } });
    for (const code of item.badges ?? []) {
      const badgeId = badgeIds.get(code);
      if (badgeId) {
        await prisma.productBadge.create({ data: { productId: product.id, badgeId } });
      }
    }

    return product;
  };

  const productIds = new Map<string, string>();
  for (const item of products) {
    const row = await upsertProduct(item, 'SIMPLE');
    productIds.set(item.slug, row.id);
  }

  for (const bundle of bundles) {
    const row = await upsertProduct(bundle, 'BUNDLE');
    productIds.set(bundle.slug, row.id);

    await prisma.bundleItem.deleteMany({ where: { bundleId: row.id } });
    for (const [index, item] of bundle.items.entries()) {
      const componentId = productIds.get(item.slug);
      if (!componentId) continue;
      await prisma.bundleItem.create({
        data: { bundleId: row.id, componentId, qty: item.qty, sortOrder: index * 10 },
      });
    }
  }
  console.log(`  товаров: ${products.length}, наборов: ${bundles.length}`);

  const hits = await prisma.collection.upsert({
    where: { slug: 'hity' },
    update: { titleRu: 'Чаще всего берут', titleKk: 'Жиі алынады' },
    create: {
      slug: 'hity',
      titleRu: 'Чаще всего берут',
      titleKk: 'Жиі алынады',
      subtitleRu: 'Позиции, которые повторяют из заказа в заказ',
      subtitleKk: 'Тапсырыстан тапсырысқа қайталанатын позициялар',
    },
  });

  await prisma.collectionProduct.deleteMany({ where: { collectionId: hits.id } });
  const hitSlugs = ['kurinoe-file-kubikami', 'kartofel-narezanniy', 'govyadina-kubikami', 'svekla'];
  for (const [index, slug] of hitSlugs.entries()) {
    const productId = productIds.get(slug);
    if (productId) {
      await prisma.collectionProduct.create({
        data: { collectionId: hits.id, productId, sortOrder: index * 10 },
      });
    }
  }

  // Секции главной пересобираем целиком: это дефолтная раскладка «из коробки»,
  // дальше владелец правит её в конструкторе.
  if ((await prisma.homeSection.count()) === 0) {
    for (const section of homeSections) {
      await prisma.homeSection.create({ data: section });
    }
    console.log(`  секций главной: ${homeSections.length}`);
  }

  console.log('Готово.');
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';

/**
 * Настройки сайта хранятся в SiteSetting группами (одна строка = одна группа).
 * Здесь описаны схемы и значения по умолчанию: если в БД группы ещё нет или в ней
 * не хватает поля, витрина всё равно получит корректный ответ.
 */

const localized = z.object({ ru: z.string(), kk: z.string() });

export const contactsSchema = z.object({
  phone: z.string(),
  whatsapp: z.string(),
  telegram: z.string(),
  instagram: z.string(),
  email: z.string(),
  address: localized,
  workingHours: localized,
});

export const deliverySchema = z.object({
  minOrder: z.number().int().min(0),
  baseFee: z.number().int().min(0),
  freeFrom: z.number().int().min(0).nullable(),
  pickupAddress: localized,
  note: localized,
});

/**
 * Оплата. Пока это ссылка Kaspi Pay на удалённую оплату: банк не сообщает сайту
 * об оплате, поэтому статус ставится вручную в кабинете. Когда подключим
 * эквайринг с callback — способ выключается одним флагом. См. PAYMENTS.md.
 */
export const paymentSchema = z.object({
  kaspiEnabled: z.boolean(),
  /*
   * Ссылку из кабинета Kaspi копируют по-разному: то с «https://», то без.
   * Без схемы браузер считает её относительной, и кнопка «Оплатить» уводит
   * на сам магазин (…/pay.kaspi.kz/pay) вместо банка — клиент не может
   * заплатить и не понимает, почему. Поэтому схему достраиваем здесь, один
   * раз для всех, кто читает настройки: и при сохранении, и при отдаче.
   */
  kaspiLink: z.string().transform((value) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
  }),
  /** Нужно ли клиенту вводить сумму самому — влияет на текст подсказки */
  kaspiAmountManual: z.boolean(),
  note: localized,
});

export const brandSchema = z.object({
  name: z.string(),
  tagline: localized,
});

export const settingsGroups = {
  contacts: {
    schema: contactsSchema,
    defaults: {
      phone: '+7 700 000 00 00',
      whatsapp: '77000000000',
      telegram: 'zagatovky',
      instagram: 'zagatovky',
      email: 'hello@zagatovky.kz',
      address: { ru: 'Алматы', kk: 'Алматы' },
      workingHours: { ru: 'Ежедневно 9:00 — 20:00', kk: 'Күн сайын 9:00 — 20:00' },
    },
  },
  delivery: {
    schema: deliverySchema,
    defaults: {
      minOrder: 3000,
      baseFee: 1500,
      freeFrom: 15000,
      pickupAddress: { ru: 'Алматы, уточним в чате', kk: 'Алматы, чатта нақтылаймыз' },
      note: {
        ru: 'Зону и время доставки согласуем в WhatsApp после оформления заказа.',
        kk: 'Жеткізу аймағы мен уақытын тапсырыстан кейін WhatsApp-та келісеміз.',
      },
    },
  },
  payment: {
    schema: paymentSchema,
    defaults: {
      kaspiEnabled: false,
      kaspiLink: '',
      kaspiAmountManual: true,
      note: {
        ru: 'Оплата после подтверждения заказа. Переводы на карту не принимаем — только на счёт компании.',
        kk: 'Төлем тапсырыс расталғаннан кейін. Картаға аударым қабылдамаймыз — тек компания шотына.',
      },
    },
  },
  brand: {
    schema: brandSchema,
    defaults: {
      name: 'ZAGATOVKY',
      tagline: {
        ru: 'Нарезано, взвешено, упаковано — вам остаётся приготовить',
        kk: 'Туралған, өлшенген, оралған — сізге тек пісіру қалды',
      },
    },
  },
} as const;

export type SettingsGroupKey = keyof typeof settingsGroups;

export const publicSettingsSchema = z.object({
  contacts: contactsSchema,
  delivery: deliverySchema,
  payment: paymentSchema,
  brand: brandSchema,
});

export type PublicSettings = z.infer<typeof publicSettingsSchema>;

/** Читает все группы разом, подставляя значения по умолчанию для отсутствующих полей. */
export const getPublicSettings = async (): Promise<PublicSettings> => {
  const rows = await prisma.siteSetting.findMany();
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const result = {} as Record<string, unknown>;
  for (const [key, group] of Object.entries(settingsGroups)) {
    const merged = { ...group.defaults, ...(stored.get(key) as object | undefined) };
    const parsed = group.schema.safeParse(merged);
    result[key] = parsed.success ? parsed.data : group.defaults;
  }

  return result as PublicSettings;
};

export const getSettingsGroup = async <K extends SettingsGroupKey>(key: K) => {
  const settings = await getPublicSettings();
  return settings[key];
};

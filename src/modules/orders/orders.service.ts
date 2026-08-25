import type { PublicSettings } from '../settings/settings.service.js';
import type { Localized } from '../catalog/catalog.schemas.js';

/** ZG-000123 — то, что клиент видит и называет в переписке. */
export const formatOrderNumber = (seq: number) => `ZG-${String(seq).padStart(6, '0')}`;

export const parseOrderNumber = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
};

const unitLabels: Record<string, string> = {
  G: 'г',
  ML: 'мл',
  PORTION: 'порц.',
  PCS: 'шт.',
};

export const formatWeight = (value: number, unit: string) =>
  `${value} ${unitLabels[unit] ?? unit}`;

/**
 * Стоимость доставки считается на сервере по настройкам сайта — клиент её не присылает.
 */
export const calculateDeliveryFee = (
  subtotal: number,
  deliveryType: 'DELIVERY' | 'PICKUP',
  delivery: PublicSettings['delivery'],
) => {
  if (deliveryType === 'PICKUP') return 0;
  if (delivery.freeFrom !== null && subtotal >= delivery.freeFrom) return 0;
  return delivery.baseFee;
};

type OrderItemLike = {
  name: Localized;
  qty: number;
  price: number;
  weightLabel: string;
};

type OrderLike = {
  number: string;
  customerName: string;
  deliveryType: 'DELIVERY' | 'PICKUP';
  address: string | null;
  comment: string | null;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: OrderItemLike[];
};

const money = (value: number) => `${value.toLocaleString('ru-RU')} тг`;

/**
 * Текст, который подставляется в WhatsApp/Telegram. Заказ уже лежит в БД,
 * так что сообщение — это подтверждение с номером, а не сам заказ.
 */
export const buildOrderMessage = (order: OrderLike, locale: 'ru' | 'kk' = 'ru') => {
  const lines: string[] = [];

  lines.push(
    locale === 'kk'
      ? `Сәлеметсіз бе! ${order.number} тапсырысын рәсімдедім.`
      : `Здравствуйте! Оформил(а) заказ ${order.number}.`,
  );
  lines.push('');

  for (const item of order.items) {
    const name = locale === 'kk' ? item.name.kk : item.name.ru;
    lines.push(`• ${name} — ${item.weightLabel} × ${item.qty} = ${money(item.price * item.qty)}`);
  }

  lines.push('');
  lines.push(`${locale === 'kk' ? 'Тауарлар' : 'Товары'}: ${money(order.subtotal)}`);
  if (order.deliveryFee > 0) {
    lines.push(`${locale === 'kk' ? 'Жеткізу' : 'Доставка'}: ${money(order.deliveryFee)}`);
  }
  lines.push(`${locale === 'kk' ? 'Барлығы' : 'Итого'}: ${money(order.total)}`);
  lines.push('');
  lines.push(
    order.deliveryType === 'PICKUP'
      ? locale === 'kk'
        ? 'Өзім алып кетемін.'
        : 'Заберу самовывозом.'
      : `${locale === 'kk' ? 'Мекенжай' : 'Адрес'}: ${order.address ?? '—'}`,
  );
  lines.push(`${locale === 'kk' ? 'Аты' : 'Имя'}: ${order.customerName}`);
  if (order.comment) {
    lines.push(`${locale === 'kk' ? 'Түсініктеме' : 'Комментарий'}: ${order.comment}`);
  }

  return lines.join('\n');
};

export const buildChatLink = (
  channel: 'WHATSAPP' | 'TELEGRAM',
  contacts: { whatsapp: string; telegram: string },
  message: string,
) => {
  const text = encodeURIComponent(message);
  if (channel === 'TELEGRAM') {
    const handle = contacts.telegram.replace(/^@/, '');
    return `https://t.me/${handle}?text=${text}`;
  }
  const phone = contacts.whatsapp.replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${text}`;
};

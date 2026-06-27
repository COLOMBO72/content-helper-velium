// handlers/subscribe.js — заглушка оплаты через ЮКасса
//
// Когда будешь включать оплату:
// 1. npm install @a2seven/yoo-checkout
// 2. Раскомментируй блок YooKassa ниже
// 3. В db.js поменяй isSubscribed() — убери return true
// 4. В middleware/auth.js раскомментируй проверку подписки

const db = require('../db');
const { MAIN_MENU } = require('./start');

// ── YooKassa (ЗАГЛУШКА) ───────────────────────────────────────────
// const { YooCheckout } = require('@a2seven/yoo-checkout');
// const checkout = new YooCheckout({
//   shopId: process.env.YOOKASSA_SHOP_ID,
//   secretKey: process.env.YOOKASSA_SECRET_KEY,
// });

const PLANS = [
  { id: 'monthly', label: '1 месяц', price: '299₽', days: 30 },
  { id: 'yearly',  label: '1 год',   price: '1990₽', days: 365 },
];

function register(bot) {

  bot.onText(/\/subscribe|💳 Подписка/, (msg) => {
    const userId = msg.from.id;
    db.upsertUser(userId, msg.from.username, msg.from.first_name);

    bot.sendMessage(msg.chat.id,
      `<b>💳 Подписка Content Helper Velium</b>\n\n` +
      `Сейчас бот бесплатен для всех пользователей 🎉\n\n` +
      `В будущем здесь появится платная подписка с расширенными возможностями.\n\n` +
      `📌 Тарифы (скоро):\n` +
      PLANS.map(p => `• ${p.label} — <b>${p.price}</b>`).join('\n') +
      `\n\n<i>Оплата через ЮКасса</i>\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<i>By Velium Group • velium.ru</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            // Когда включишь оплату — замени эти кнопки на реальные
            [{ text: '🔜 Скоро — 1 месяц (299₽)', callback_data: 'sub_soon' }],
            [{ text: '🔜 Скоро — 1 год (1990₽)',  callback_data: 'sub_soon' }],
          ],
        },
      }
    );
  });

  bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('sub_')) return;
    bot.answerCallbackQuery(query.id, { text: 'Оплата скоро будет доступна!' });

    // ── Когда будешь включать ЮКасса — раскомментируй ────────────
    /*
    const planId = query.data.replace('sub_', '');
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return;

    try {
      const payment = await checkout.createPayment({
        amount: { value: plan.price.replace('₽', ''), currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: `https://t.me/${process.env.BOT_USERNAME}`,
        },
        capture: true,
        description: `Content Helper Velium — ${plan.label}`,
        metadata: {
          telegram_id: query.from.id,
          plan_id: planId,
          days: plan.days,
        },
      });

      bot.sendMessage(query.message.chat.id,
        `💳 <b>Оплата ${plan.label}</b>\n\nНажми кнопку для оплаты:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: `Оплатить ${plan.price}`, url: payment.confirmation.confirmation_url }
            ]],
          },
        }
      );
    } catch (e) {
      bot.sendMessage(query.message.chat.id, `❌ Ошибка создания платежа: ${e.message}`);
    }
    */
  });
}

// ── Webhook от ЮКасса — вызывать из Express сервера ──────────────
// Раскомментируй когда будешь подключать оплату
/*
async function handleYooKassaWebhook(body) {
  if (body.event !== 'payment.succeeded') return;

  const meta = body.object.metadata;
  const telegramId = parseInt(meta.telegram_id);
  const days = parseInt(meta.days);

  const until = Math.floor(Date.now() / 1000) + (days * 86400);
  db.db.prepare('UPDATE users SET subscribed = 1, trial_until = ? WHERE telegram_id = ?')
    .run(until, telegramId);

  // Уведомляем пользователя
  // (нужна ссылка на bot instance)
}
module.exports.handleYooKassaWebhook = handleYooKassaWebhook;
*/

module.exports = { register };

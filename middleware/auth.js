// middleware/auth.js — проверка подписки
// Сейчас бесплатно для всех. Когда включишь оплату — раскомментируй проверку.

const db = require('../db');

/**
 * Проверяет что пользователь зарегистрирован и имеет доступ.
 * Вызывать перед любым handler'ом кроме /start и /subscribe.
 */
function requireAccess(bot, msg, callback) {
  const userId = msg.from.id;
  const user = db.getUser(userId);

  if (!user) {
    bot.sendMessage(msg.chat.id,
      '👋 Сначала запусти бота командой /start'
    );
    return;
  }

  // ── Заглушка оплаты ──────────────────────────────────────────────
  // Пока доступ бесплатный для всех.
  // Когда будешь включать оплату — раскомментируй блок ниже
  // и закомментируй строку callback()

  /*
  if (!db.isSubscribed(userId)) {
    bot.sendMessage(msg.chat.id,
      '🔒 <b>Доступ закрыт</b>\n\n' +
      'Для использования бота необходима подписка.\n\n' +
      'Нажми /subscribe чтобы оформить доступ.',
      { parse_mode: 'HTML' }
    );
    return;
  }
  */

  callback();
}

module.exports = { requireAccess };

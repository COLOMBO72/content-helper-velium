// handlers/queue.js — просмотр очереди постов

const db = require('../db');
const { MAIN_MENU } = require('./start');

function register(bot) {

  bot.onText(/\/queue|📋 Очередь постов/, (msg) => {
    const userId = msg.from.id;
    db.upsertUser(userId, msg.from.username, msg.from.first_name);

    const queue = db.getUserQueue(userId, 20);

    if (queue.length === 0) {
      bot.sendMessage(msg.chat.id,
        `📋 <b>Очередь пуста</b>\n\nПосты будут появляться здесь когда ты опубликуешь что-то в своём TG канале.`,
        { parse_mode: 'HTML', ...MAIN_MENU }
      );
      return;
    }

    const platformEmoji = { vk: '🔵', telegram: '✈️', instagram: '📸', twitter: '🐦' };
    const lines = queue.map((item, i) => {
      const emoji = platformEmoji[item.platform] || '📢';
      const date = new Date(item.scheduled_at * 1000);
      const timeStr = date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      const preview = (item.text || '').slice(0, 40) + ((item.text || '').length > 40 ? '...' : '');
      return `${i + 1}. ${emoji} ${item.platform.toUpperCase()} — ${timeStr}\n   ${preview || '(без текста)'}`;
    });

    bot.sendMessage(msg.chat.id,
      `📋 <b>Очередь постов (${queue.length})</b>\n\n` +
      lines.join('\n\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗑 Очистить опубликованные', callback_data: 'queue_clear' }],
            [{ text: '🔙 Назад', callback_data: 'queue_back' }],
          ],
        },
      }
    );
  });

  bot.on('callback_query', (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    bot.answerCallbackQuery(query.id);

    if (query.data === 'queue_clear') {
      db.clearPosted(userId);
      bot.sendMessage(chatId, '✅ Опубликованные посты удалены из истории.', MAIN_MENU);
    }
    if (query.data === 'queue_back') {
      bot.sendMessage(chatId, '👈 Главное меню', MAIN_MENU);
    }
  });
}

module.exports = { register };

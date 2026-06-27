// handlers/setup.js — мастер настройки пользователя
// Пошаговый диалог: канал-источник → DeepL ключ (опционально) → готово

const db = require('../db');
const { MAIN_MENU } = require('./start');

// Состояния диалога (хранятся в памяти, при рестарте сбрасываются)
const sessions = {};

const STEPS = {
  CHANNEL: 'channel',
  DEEPL: 'deepl',
};

function register(bot) {

  // ── /setup и кнопка ──────────────────────────────────────────────
  bot.onText(/\/setup|⚙️ Настройки/, (msg) => {
    const userId = msg.from.id;
    db.upsertUser(userId, msg.from.username, msg.from.first_name);
    const settings = db.getSettings(userId);

    bot.sendMessage(msg.chat.id,
      `<b>⚙️ Настройки Content Helper</b>\n\n` +
      `Текущий TG канал-источник: <b>${settings?.source_channel || 'не задан'}</b>\n` +
      `DeepL API ключ: <b>${settings?.deepl_key ? '✅ задан' : '❌ не задан'}</b>\n\n` +
      `Выбери что настроить:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📡 Изменить TG канал-источник', callback_data: 'setup_channel' }],
            [{ text: '🌐 Задать DeepL API ключ', callback_data: 'setup_deepl' }],
            [{ text: '📡 Управление платформами', callback_data: 'goto_platforms' }],
            [{ text: '✅ Готово', callback_data: 'setup_done' }],
          ],
        },
      }
    );
  });

  // ── Callback кнопок ──────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    if (data === 'setup_channel') {
      sessions[userId] = { step: STEPS.CHANNEL };
      bot.sendMessage(chatId,
        `📡 <b>Укажи TG канал-источник</b>\n\n` +
        `Отправь username канала, например:\n` +
        `<code>@gta6_join</code>\n\n` +
        `Бот должен быть добавлен как <b>администратор</b> этого канала.`,
        { parse_mode: 'HTML' }
      );
    }

    if (data === 'setup_deepl') {
      sessions[userId] = { step: STEPS.DEEPL };
      bot.sendMessage(chatId,
        `🌐 <b>DeepL API ключ</b>\n\n` +
        `Нужен только если хочешь переводить посты.\n\n` +
        `Получить бесплатный ключ (500к символов/мес):\n` +
        `👉 deepl.com/pro-api\n\n` +
        `Отправь ключ (формат: <code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx</code>)\n` +
        `или напиши <b>пропустить</b>`,
        { parse_mode: 'HTML' }
      );
    }

    if (data === 'goto_platforms') {
      // Эмулируем команду /platforms
      bot.sendMessage(chatId, '📡 Открываю платформы...', MAIN_MENU);
      bot.emit('text', { ...query.message, text: '/platforms', from: query.from });
    }

    if (data === 'setup_done') {
      const settings = db.getSettings(userId);
      if (!settings?.source_channel) {
        bot.sendMessage(chatId,
          `⚠️ Сначала укажи TG канал-источник!\n\nНажми "📡 Изменить TG канал-источник"`,
          { parse_mode: 'HTML' }
        );
        return;
      }
      db.updateSettings(userId, { setup_done: 1 });
      delete sessions[userId];
      bot.sendMessage(chatId,
        `✅ <b>Настройка завершена!</b>\n\n` +
        `Канал-источник: <b>${settings.source_channel}</b>\n\n` +
        `Теперь подключи платформы через <b>📡 Мои платформы</b>`,
        { parse_mode: 'HTML', ...MAIN_MENU }
      );
    }
  });

  // ── Обработка текстовых ответов в диалоге ─────────────────────────
  bot.on('message', (msg) => {
    const userId = msg.from.id;
    const session = sessions[userId];
    if (!session || !msg.text) return;

    // Игнорируем команды и кнопки меню
    if (msg.text.startsWith('/') || msg.text.startsWith('⚙️') ||
        msg.text.startsWith('📡') || msg.text.startsWith('📋') ||
        msg.text.startsWith('📊') || msg.text.startsWith('💳') ||
        msg.text.startsWith('❓')) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Шаг: ввод канала
    if (session.step === STEPS.CHANNEL) {
      let channel = text;
      if (!channel.startsWith('@')) channel = '@' + channel;

      db.updateSettings(userId, { source_channel: channel });
      delete sessions[userId];

      bot.sendMessage(chatId,
        `✅ Канал-источник сохранён: <b>${channel}</b>\n\n` +
        `Убедись что бот добавлен как администратор в этот канал!`,
        { parse_mode: 'HTML' }
      );

      // Возвращаем в настройки
      setTimeout(() => {
        bot.emit('text', { ...msg, text: '/setup' });
      }, 500);
    }

    // Шаг: ввод DeepL ключа
    if (session.step === STEPS.DEEPL) {
      if (text.toLowerCase() === 'пропустить') {
        delete sessions[userId];
        bot.sendMessage(chatId, '✅ DeepL ключ пропущен. Перевод не будет доступен.', MAIN_MENU);
        return;
      }

      // Базовая проверка формата ключа
      if (text.length < 20) {
        bot.sendMessage(chatId, '❌ Ключ слишком короткий. Попробуй ещё раз или напиши "пропустить"');
        return;
      }

      db.updateSettings(userId, { deepl_key: text });
      delete sessions[userId];

      bot.sendMessage(chatId,
        `✅ DeepL ключ сохранён!\n\n` +
        `Теперь можешь включить перевод для каждой платформы отдельно в разделе <b>📡 Мои платформы</b>`,
        { parse_mode: 'HTML' }
      );

      setTimeout(() => {
        bot.emit('text', { ...msg, text: '/setup' });
      }, 500);
    }
  });
}

module.exports = { register, sessions };

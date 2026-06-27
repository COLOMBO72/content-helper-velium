// handlers/platforms.js — подключение и управление платформами
// VK, Telegram, Instagram, Twitter/X

const db = require('../db');
const vk = require('../publishers/vk');
const tg = require('../publishers/telegram');
const instagram = require('../publishers/instagram');
const twitter = require('../publishers/twitter');
const { MAIN_MENU } = require('./start');

// Состояния диалога подключения платформ
const sessions = {};

const PLATFORM_INFO = {
  vk: {
    name: 'VK',
    emoji: '🔵',
    fields: [
      { key: 'token', label: 'VK токен группы', hint: 'Управление группой → Работа с API → Создать ключ\nПрава: wall + photos + groups' },
      { key: 'group_id', label: 'ID группы VK', hint: 'Числовой ID из адреса группы\nvk.com/club<b>123456789</b> → 123456789' },
    ],
    intervalQuestion: true,
    translateQuestion: true,
  },
  telegram: {
    name: 'Telegram канал',
    emoji: '✈️',
    fields: [
      { key: 'bot_token', label: 'Токен бота', hint: 'Создай бота через @BotFather и добавь его как админа в целевой канал' },
      { key: 'channel_id', label: 'Username или ID канала', hint: 'Например: @my_channel или -1001234567890' },
    ],
    intervalQuestion: true,
    translateQuestion: true,
  },
  instagram: {
    name: 'Instagram',
    emoji: '📸',
    fields: [
      { key: 'access_token', label: 'Meta Access Token', hint: 'Нужен Meta Developer App + App Review (~2-4 недели)\ndevelopers.facebook.com' },
      { key: 'ig_user_id', label: 'Instagram User ID', hint: 'Числовой ID аккаунта из Graph API\ngraph.facebook.com/me?fields=id&access_token=TOKEN' },
    ],
    intervalQuestion: true,
    translateQuestion: true,
  },
  twitter: {
    name: 'Twitter / X',
    emoji: '🐦',
    fields: [
      { key: 'api_key', label: 'API Key', hint: '⚠️ Нужен платный X API план ($100/мес)\ndeveloper.twitter.com' },
      { key: 'api_secret', label: 'API Secret', hint: '' },
      { key: 'access_token', label: 'Access Token', hint: '' },
      { key: 'access_token_secret', label: 'Access Token Secret', hint: '' },
    ],
    intervalQuestion: true,
    translateQuestion: true,
  },
};

function buildPlatformsMenu(userId) {
  const platforms = db.getPlatforms(userId);

  const rows = Object.entries(PLATFORM_INFO).map(([key, info]) => {
    const existing = platforms.find(p => p.platform === key);
    if (existing) {
      const status = existing.enabled ? '✅' : '⏸';
      return [{ text: `${status} ${info.emoji} ${info.name}`, callback_data: `plt_manage_${key}` }];
    } else {
      return [{ text: `➕ ${info.emoji} Подключить ${info.name}`, callback_data: `plt_add_${key}` }];
    }
  });

  rows.push([{ text: '🔙 Назад', callback_data: 'plt_back' }]);

  return {
    inline_keyboard: rows,
  };
}

function register(bot) {

  // ── /platforms и кнопка ──────────────────────────────────────────
  bot.onText(/\/platforms|📡 Мои платформы/, (msg) => {
    const userId = msg.from.id;
    db.upsertUser(userId, msg.from.username, msg.from.first_name);

    bot.sendMessage(msg.chat.id,
      `<b>📡 Мои платформы</b>\n\nВыбери платформу для управления:`,
      { parse_mode: 'HTML', reply_markup: buildPlatformsMenu(userId) }
    );
  });

  // ── Callback ─────────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const data = query.data;

    if (!data.startsWith('plt_')) return;
    bot.answerCallbackQuery(query.id);

    // Назад
    if (data === 'plt_back') {
      bot.sendMessage(chatId, '👈 Главное меню', MAIN_MENU);
      return;
    }

    // Добавить платформу
    if (data.startsWith('plt_add_')) {
      const platform = data.replace('plt_add_', '');
      const info = PLATFORM_INFO[platform];
      if (!info) return;

      sessions[userId] = {
        action: 'add',
        platform,
        fieldIndex: 0,
        collected: {},
      };

      const field = info.fields[0];
      bot.sendMessage(chatId,
        `${info.emoji} <b>Подключение ${info.name}</b>\n\n` +
        `<b>${field.label}:</b>\n${field.hint ? `<i>${field.hint}</i>` : ''}\n\nВведи значение:`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Управление существующей платформой
    if (data.startsWith('plt_manage_')) {
      const platform = data.replace('plt_manage_', '');
      const info = PLATFORM_INFO[platform];
      const existing = db.getPlatformByType(userId, platform);
      if (!existing) return;

      const toggleLabel = existing.enabled ? '⏸ Отключить' : '▶️ Включить';
      const translateLabel = existing.translate ? '🌐 Перевод: ВКЛ' : '🌐 Перевод: ВЫКЛ';
      const intervalLabel = existing.queue_interval > 0
        ? `⏱ Интервал: ${existing.queue_interval} мин`
        : '⏱ Интервал: сразу';

      bot.editMessageText(
        `${info.emoji} <b>${info.name}</b>\n\n` +
        `Статус: ${existing.enabled ? '✅ активна' : '⏸ отключена'}\n` +
        `Перевод: ${existing.translate ? '🌐 включён' : 'выключен'}\n` +
        `Интервал: ${existing.queue_interval > 0 ? `${existing.queue_interval} мин` : 'сразу'}\n` +
        `Цель: <code>${existing.target || 'не задана'}</code>`,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: toggleLabel, callback_data: `plt_toggle_${existing.id}` }],
              [{ text: translateLabel, callback_data: `plt_translate_${existing.id}` }],
              [{ text: intervalLabel, callback_data: `plt_interval_${existing.id}` }],
              [{ text: '🔑 Обновить ключи', callback_data: `plt_add_${platform}` }],
              [{ text: '🗑 Удалить', callback_data: `plt_delete_${existing.id}` }],
              [{ text: '🔙 Назад', callback_data: 'plt_list' }],
            ],
          },
        }
      );
      return;
    }

    // Включить/выключить
    if (data.startsWith('plt_toggle_')) {
      const id = parseInt(data.replace('plt_toggle_', ''));
      const p = db.getPlatform(id);
      if (!p) return;
      db.togglePlatform(id, !p.enabled);
      bot.sendMessage(chatId,
        `${p.enabled ? '⏸ Платформа отключена' : '✅ Платформа включена'}: <b>${p.platform.toUpperCase()}</b>`,
        { parse_mode: 'HTML', reply_markup: buildPlatformsMenu(userId) }
      );
      return;
    }

    // Перевод вкл/выкл
    if (data.startsWith('plt_translate_')) {
      const id = parseInt(data.replace('plt_translate_', ''));
      const p = db.getPlatform(id);
      if (!p) return;
      const settings = db.getSettings(userId);

      if (!settings?.deepl_key && !p.translate) {
        bot.sendMessage(chatId,
          '❌ Сначала укажи DeepL API ключ в <b>⚙️ Настройках</b>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      db.upsertPlatform(userId, p.platform, { translate: p.translate ? 0 : 1 });
      bot.sendMessage(chatId,
        `🌐 Перевод для <b>${p.platform.toUpperCase()}</b>: ${!p.translate ? 'включён' : 'выключен'}`,
        { parse_mode: 'HTML', reply_markup: buildPlatformsMenu(userId) }
      );
      return;
    }

    // Изменить интервал
    if (data.startsWith('plt_interval_')) {
      const id = parseInt(data.replace('plt_interval_', ''));
      const p = db.getPlatform(id);
      if (!p) return;

      sessions[userId] = { action: 'interval', platformId: id, platform: p.platform };

      bot.sendMessage(chatId,
        `⏱ <b>Интервал очереди для ${p.platform.toUpperCase()}</b>\n\n` +
        `Как часто публиковать посты?\n` +
        `Введи число минут или 0 для публикации сразу.\n\n` +
        `Примеры: <code>0</code> сразу, <code>60</code> раз в час, <code>120</code> раз в 2 часа`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Удалить платформу
    if (data.startsWith('plt_delete_')) {
      const id = parseInt(data.replace('plt_delete_', ''));
      const p = db.getPlatform(id);
      if (!p) return;

      bot.editMessageText(
        `🗑 Удалить <b>${p.platform.toUpperCase()}</b>?\n\nВсе токены и очередь этой платформы будут удалены.`,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, удалить', callback_data: `plt_confirm_delete_${id}` },
                { text: '❌ Отмена', callback_data: 'plt_list' },
              ],
            ],
          },
        }
      );
      return;
    }

    if (data.startsWith('plt_confirm_delete_')) {
      const id = parseInt(data.replace('plt_confirm_delete_', ''));
      const p = db.getPlatform(id);
      if (!p) return;
      db.deletePlatform(id);
      bot.sendMessage(chatId,
        `🗑 Платформа <b>${p.platform.toUpperCase()}</b> удалена.`,
        { parse_mode: 'HTML', reply_markup: buildPlatformsMenu(userId) }
      );
      return;
    }

    // Список платформ
    if (data === 'plt_list') {
      bot.editMessageText(
        '<b>📡 Мои платформы</b>\n\nВыбери платформу:',
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          reply_markup: buildPlatformsMenu(userId),
        }
      );
      return;
    }
  });

  // ── Обработка текстовых ответов ──────────────────────────────────
  bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const session = sessions[userId];
    if (!session || !msg.text) return;

    // Игнорируем команды и кнопки меню
    if (msg.text.startsWith('/') || msg.text.match(/^[⚙️📡📋📊💳❓]/u)) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    // Установка интервала
    if (session.action === 'interval') {
      const minutes = parseInt(text);
      if (isNaN(minutes) || minutes < 0) {
        bot.sendMessage(chatId, '❌ Введи число минут (0 или больше)');
        return;
      }
      db.upsertPlatform(userId, session.platform, { queue_interval: minutes });
      delete sessions[userId];
      const label = minutes === 0 ? 'сразу' : `каждые ${minutes} минут`;
      bot.sendMessage(chatId,
        `✅ Интервал для <b>${session.platform.toUpperCase()}</b> установлен: <b>${label}</b>`,
        { parse_mode: 'HTML', reply_markup: buildPlatformsMenu(userId) }
      );
      return;
    }

    // Пошаговый ввод ключей платформы
    if (session.action === 'add') {
      const { platform, fieldIndex, collected } = session;
      const info = PLATFORM_INFO[platform];
      const field = info.fields[fieldIndex];

      collected[field.key] = text;
      session.fieldIndex++;

      // Ещё есть поля?
      if (session.fieldIndex < info.fields.length) {
        const nextField = info.fields[session.fieldIndex];
        bot.sendMessage(chatId,
          `<b>${nextField.label}:</b>\n${nextField.hint ? `<i>${nextField.hint}</i>\n` : ''}\nВведи значение:`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Все поля собраны — спрашиваем интервал
      session.action = 'interval_new';
      bot.sendMessage(chatId,
        `⏱ <b>Интервал очереди</b>\n\n` +
        `Сколько минут между постами?\n` +
        `<code>0</code> — публиковать сразу\n` +
        `<code>120</code> — раз в 2 часа\n\n` +
        `Введи число:`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (session.action === 'interval_new') {
      const minutes = parseInt(text);
      if (isNaN(minutes) || minutes < 0) {
        bot.sendMessage(chatId, '❌ Введи число минут (0 или больше)');
        return;
      }
      session.interval = minutes;
      session.action = 'translate_new';

      const settings = db.getSettings(userId);
      if (!settings?.deepl_key) {
        // Нет DeepL — пропускаем вопрос про перевод
        session.translate = 0;
        finishAddPlatform(bot, chatId, userId, session);
        return;
      }

      bot.sendMessage(chatId,
        `🌐 <b>Перевод через DeepL?</b>\n\n` +
        `Переводить тексты постов перед публикацией на этой платформе?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, переводить', callback_data: 'plt_set_translate_1' },
                { text: '❌ Нет', callback_data: 'plt_set_translate_0' },
              ],
            ],
          },
        }
      );
      return;
    }
  });

  // Callback для выбора перевода при добавлении
  bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const session = sessions[userId];
    const data = query.data;

    if (!data.startsWith('plt_set_translate_') || !session) return;
    bot.answerCallbackQuery(query.id);

    const translate = parseInt(data.replace('plt_set_translate_', ''));
    session.translate = translate;
    finishAddPlatform(bot, query.message.chat.id, userId, session);
  });
}

async function finishAddPlatform(bot, chatId, userId, session) {
  const { platform, collected, interval, translate } = session;
  const info = PLATFORM_INFO[platform];
  const validators = { vk, telegram: require('../publishers/telegram'), instagram, twitter };

  const credentials = JSON.stringify(collected);

  // Сохраняем платформу
  db.upsertPlatform(userId, platform, {
    credentials,
    target: collected.channel_id || collected.group_id || null,
    translate: translate || 0,
    queue_interval: interval || 0,
    enabled: 1,
  });

  delete sessions[userId];

  // Валидируем ключи
  bot.sendMessage(chatId, `⏳ Проверяю ключи для ${info.emoji} ${info.name}...`);

  try {
    const validator = validators[platform];
    const valid = await validator.validateCredentials(credentials);

    if (valid) {
      bot.sendMessage(chatId,
        `✅ <b>${info.name} подключена!</b>\n\nКлючи проверены — всё работает.`,
        { parse_mode: 'HTML', reply_markup: require('./start').MAIN_MENU }
      );
    } else {
      bot.sendMessage(chatId,
        `⚠️ <b>${info.name} сохранена, но ключи не прошли проверку.</b>\n\n` +
        `Платформа добавлена, но посты могут не публиковаться.\n` +
        `Проверь правильность ключей через /platforms`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (e) {
    bot.sendMessage(chatId,
      `⚠️ Платформа сохранена (проверка недоступна): ${e.message}`,
      { parse_mode: 'HTML' }
    );
  }
}

module.exports = { register };

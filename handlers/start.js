// handlers/start.js — /start, главный экран, /help

const db = require('../db');

const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      ['⚙️ Настройки', '📡 Мои платформы'],
      ['📋 Очередь постов', '📊 Статус'],
      ['💳 Подписка', '❓ Помощь'],
    ],
    resize_keyboard: true,
  },
};

function register(bot) {

  // ── /start ────────────────────────────────────────────────────────
  bot.onText(/\/start/, (msg) => {
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'друг';

    db.upsertUser(userId, msg.from.username, firstName);
    const settings = db.getSettings(userId);

    const welcomeText = settings?.setup_done
      ? `👋 С возвращением, <b>${firstName}</b>!`
      : `👋 Привет, <b>${firstName}</b>!\n\n` +
        `Добро пожаловать в <b>Content Helper Velium</b> — ` +
        `твой автопостинг из Telegram во все соцсети.\n\n` +
        `Для начала настрой бота: нажми <b>⚙️ Настройки</b>`;

    bot.sendMessage(msg.chat.id,
      welcomeText + '\n\n' +
      `━━━━━━━━━━━━━━━━\n` +
      `<i>By Velium Group • velium.ru</i>`,
      { parse_mode: 'HTML', ...MAIN_MENU }
    );
  });

  // ── /help и кнопка ────────────────────────────────────────────────
  bot.onText(/\/help|❓ Помощь/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `<b>📖 Content Helper Velium — справка</b>\n\n` +

      `<b>Как это работает:</b>\n` +
      `1. Настрой бота — укажи свой TG канал-источник\n` +
      `2. Подключи платформы (VK, TG, Instagram, X)\n` +
      `3. Публикуй посты в свой TG канал\n` +
      `4. Бот автоматически репостит их везде\n\n` +

      `<b>Команды:</b>\n` +
      `/start — главный экран\n` +
      `/setup — мастер настройки\n` +
      `/platforms — управление платформами\n` +
      `/queue — очередь постов\n` +
      `/status — статус и статистика\n` +
      `/subscribe — подписка\n\n` +

      `<b>Поддерживаемые платформы:</b>\n` +
      `🔵 VK — бесплатно\n` +
      `✈️ Telegram канал — бесплатно\n` +
      `📸 Instagram — нужен Meta App Review\n` +
      `🐦 Twitter/X — нужен X API ($100/мес у X)\n\n` +

      `<b>Перевод:</b> через DeepL API\n` +
      `Бесплатно до 500к символов/мес\n` +
      `deepl.com/pro-api\n\n` +

      `━━━━━━━━━━━━━━━━\n` +
      `<i>By Velium Group • velium.ru</i>`,
      { parse_mode: 'HTML', ...MAIN_MENU }
    );
  });

  // ── /status и кнопка ─────────────────────────────────────────────
  bot.onText(/\/status|📊 Статус/, (msg) => {
    const userId = msg.from.id;
    db.upsertUser(userId, msg.from.username, msg.from.first_name);

    const user = db.getUser(userId);
    const settings = db.getSettings(userId);
    const platforms = db.getPlatforms(userId);
    const queue = db.getUserQueue(userId, 100);

    const platformList = platforms.length > 0
      ? platforms.map(p => {
          const emoji = { vk: '🔵', telegram: '✈️', instagram: '📸', twitter: '🐦' }[p.platform] || '📢';
          const status = p.enabled ? '✅' : '⏸';
          const translate = p.translate ? ' 🌐' : '';
          const interval = p.queue_interval > 0 ? ` ⏱ каждые ${p.queue_interval}м` : ' (сразу)';
          return `${status} ${emoji} ${p.platform.toUpperCase()}${translate}${interval}`;
        }).join('\n')
      : 'Не подключено';

    const subscribeStatus = user?.subscribed
      ? '✅ Активна'
      : '🆓 Бесплатный доступ';

    bot.sendMessage(msg.chat.id,
      `<b>📊 Твой статус</b>\n\n` +
      `👤 ID: <code>${userId}</code>\n` +
      `📡 Источник: ${settings?.source_channel || 'не задан'}\n` +
      `💳 Подписка: ${subscribeStatus}\n\n` +
      `<b>Платформы:</b>\n${platformList}\n\n` +
      `<b>Очередь:</b> ${queue.length} постов ожидают\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<i>By Velium Group • velium.ru</i>`,
      { parse_mode: 'HTML', ...MAIN_MENU }
    );
  });

  return MAIN_MENU;
}

module.exports = { register, MAIN_MENU };

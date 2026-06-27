// bot.js — точка входа Content Helper Velium
// Слушает все TG каналы пользователей и запускает scheduler

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const scheduler = require('./scheduler');

// Handlers
const startHandler = require('./handlers/start');
const setupHandler = require('./handlers/setup');
const platformsHandler = require('./handlers/platforms');
const queueHandler = require('./handlers/queue');
const subscribeHandler = require('./handlers/subscribe');

// ── Инициализация бота ────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан в .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Папка для временных фото
const PHOTOS_DIR = path.join(__dirname, 'tmp_photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR);

// ── Регистрируем все handlers ─────────────────────────────────────
startHandler.register(bot);
setupHandler.register(bot);
platformsHandler.register(bot);
queueHandler.register(bot);
subscribeHandler.register(bot);

// ── Запускаем scheduler (обработчик очереди) ─────────────────────
scheduler.init(bot);

// ── Слушаем посты из TG каналов ──────────────────────────────────
bot.on('channel_post', async (msg) => {
  // Получаем username или id канала
  const channelUsername = msg.chat.username ? `@${msg.chat.username}` : String(msg.chat.id);

  // Ищем всех пользователей у которых этот канал указан как источник
  const users = findUsersWithChannel(channelUsername);

  if (users.length === 0) return;

  console.log(`[TG] Новый пост из ${channelUsername}, пользователей: ${users.length}`);

  let photoPath = null;

  // Если есть фото — скачиваем один раз
  if (msg.photo) {
    try {
      const bestPhoto = msg.photo[msg.photo.length - 1];
      const fileInfo = await bot.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
      photoPath = path.join(PHOTOS_DIR, `photo_${Date.now()}.jpg`);
      await downloadFile(fileUrl, photoPath);
      console.log(`[TG] Фото скачано: ${photoPath}`);
    } catch (e) {
      console.error('[TG] Ошибка скачивания фото:', e.message);
    }
  }

  const text = msg.text || msg.caption || '';

  // Добавляем пост в очередь каждого пользователя
  for (const user of users) {
    try {
      const count = scheduler.enqueue(user.telegram_id, text, photoPath);
      console.log(`[Queue] user=${user.telegram_id} добавлено для ${count} платформ`);
    } catch (e) {
      console.error(`[Queue] Ошибка для user=${user.telegram_id}:`, e.message);
    }
  }
});

// ── Вспомогательные функции ───────────────────────────────────────

/**
 * Находит всех пользователей у которых указан данный канал как источник
 */
function findUsersWithChannel(channelUsername) {
  const normalized = channelUsername.toLowerCase().replace('@', '');

  // Берём все настройки где setup_done = 1
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, 'data.db');
  const rawDb = new Database(dbPath);

  const rows = rawDb.prepare(`
    SELECT us.user_id as telegram_id, us.source_channel
    FROM user_settings us
    JOIN users u ON us.user_id = u.telegram_id
    WHERE us.setup_done = 1 AND us.source_channel IS NOT NULL
  `).all();

  rawDb.close();

  return rows.filter(s => {
    const sc = s.source_channel.toLowerCase().replace('@', '');
    return sc === normalized;
  });
}

// ── Polling ошибки ────────────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('[POLLING ERROR]', err.code, err.message);
});

// ── Download helper ───────────────────────────────────────────────
async function downloadFile(url, dest) {
  const response = await axios.get(url, { responseType: 'stream' });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

console.log('🚀 Content Helper Velium запущен!');
console.log('   By Velium Group • velium.ru');

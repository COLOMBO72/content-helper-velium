// db.js — база данных SQLite
// Все данные пользователей, платформы, очередь постов

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

// Включаем WAL режим для производительности
db.pragma('journal_mode = WAL');

// ─── Создание таблиц ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id     INTEGER PRIMARY KEY,
    username        TEXT,
    first_name      TEXT,
    -- subscribed: 0 = нет, 1 = активна
    subscribed      INTEGER DEFAULT 0,
    -- trial_until: timestamp, пока не используется (заглушка)
    trial_until     INTEGER DEFAULT 0,
    created_at      INTEGER DEFAULT (strftime('%s','now'))
  );

  -- Настройки пользователя: канал-источник + API ключи
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id         INTEGER PRIMARY KEY REFERENCES users(telegram_id),
    source_channel  TEXT,           -- @username TG канала-источника
    deepl_key       TEXT,           -- DeepL API key (опционально)
    setup_done      INTEGER DEFAULT 0  -- прошёл ли мастер настройки
  );

  -- Платформы: каждая строка = одна платформа одного пользователя
  CREATE TABLE IF NOT EXISTS platforms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(telegram_id),
    platform        TEXT NOT NULL,  -- 'vk' | 'telegram' | 'instagram' | 'twitter'
    enabled         INTEGER DEFAULT 1,
    translate       INTEGER DEFAULT 0,  -- 1 = переводить через DeepL
    -- Токены/ключи для этой платформы (JSON строка)
    credentials     TEXT DEFAULT '{}',
    -- Цель публикации (ссылка на группу/канал)
    target          TEXT,
    -- Интервал очереди в минутах (0 = постить сразу)
    queue_interval  INTEGER DEFAULT 0,
    created_at      INTEGER DEFAULT (strftime('%s','now'))
  );

  -- Очередь постов
  CREATE TABLE IF NOT EXISTS queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(telegram_id),
    platform_id     INTEGER REFERENCES platforms(id),
    text            TEXT,
    photo_url       TEXT,           -- локальный путь к фото
    scheduled_at    INTEGER,        -- когда публиковать (timestamp)
    posted          INTEGER DEFAULT 0,  -- 0 = ждёт, 1 = опубликован, 2 = ошибка
    error_msg       TEXT,
    created_at      INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ─── Users ────────────────────────────────────────────────────────

function upsertUser(telegramId, username, firstName) {
  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
  `).run(telegramId, username || null, firstName || null);

  // Создаём настройки если нет
  db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)
  `).run(telegramId);
}

function getUser(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function isSubscribed(telegramId) {
  const user = getUser(telegramId);
  // Пока бесплатно — всегда true. Когда включишь оплату — раскомментируй логику ниже
  return true;
  // return user && user.subscribed === 1;
}

// ─── Settings ─────────────────────────────────────────────────────

function getSettings(userId) {
  return db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
}

function updateSettings(userId, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  db.prepare(`UPDATE user_settings SET ${set} WHERE user_id = ?`).run(...values, userId);
}

// ─── Platforms ────────────────────────────────────────────────────

function getPlatforms(userId) {
  return db.prepare('SELECT * FROM platforms WHERE user_id = ?').all(userId);
}

function getPlatform(id) {
  return db.prepare('SELECT * FROM platforms WHERE id = ?').get(id);
}

function getPlatformByType(userId, platform) {
  return db.prepare('SELECT * FROM platforms WHERE user_id = ? AND platform = ?').get(userId, platform);
}

function upsertPlatform(userId, platform, data) {
  const existing = getPlatformByType(userId, platform);
  if (existing) {
    const keys = Object.keys(data);
    const set = keys.map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE platforms SET ${set} WHERE id = ?`).run(...keys.map(k => data[k]), existing.id);
    return existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO platforms (user_id, platform, credentials, target, translate, queue_interval, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(userId, platform,
      data.credentials || '{}',
      data.target || null,
      data.translate || 0,
      data.queue_interval || 0
    );
    return result.lastInsertRowid;
  }
}

function togglePlatform(id, enabled) {
  db.prepare('UPDATE platforms SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

function deletePlatform(id) {
  db.prepare('DELETE FROM platforms WHERE id = ?').run(id);
}

// ─── Queue ────────────────────────────────────────────────────────

function addToQueue(userId, platformId, text, photoUrl, scheduledAt) {
  return db.prepare(`
    INSERT INTO queue (user_id, platform_id, text, photo_url, scheduled_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, platformId, text, photoUrl || null, scheduledAt);
}

function getPendingPosts(now) {
  return db.prepare(`
    SELECT q.*, p.platform, p.credentials, p.target, p.translate, p.queue_interval,
           u.telegram_id
    FROM queue q
    JOIN platforms p ON q.platform_id = p.id
    JOIN users u ON q.user_id = u.telegram_id
    WHERE q.posted = 0 AND q.scheduled_at <= ? AND p.enabled = 1
    ORDER BY q.scheduled_at ASC
  `).all(now);
}

function markPosted(id) {
  db.prepare('UPDATE queue SET posted = 1 WHERE id = ?').run(id);
}

function markFailed(id, error) {
  db.prepare('UPDATE queue SET posted = 2, error_msg = ? WHERE id = ?').run(error, id);
}

function getUserQueue(userId, limit = 10) {
  return db.prepare(`
    SELECT q.*, p.platform, p.target
    FROM queue q
    JOIN platforms p ON q.platform_id = p.id
    WHERE q.user_id = ? AND q.posted = 0
    ORDER BY q.scheduled_at ASC
    LIMIT ?
  `).all(userId, limit);
}

function clearPosted(userId) {
  db.prepare('DELETE FROM queue WHERE user_id = ? AND posted = 1').run(userId);
}

module.exports = {
  upsertUser, getUser, isSubscribed,
  getSettings, updateSettings,
  getPlatforms, getPlatform, getPlatformByType, upsertPlatform, togglePlatform, deletePlatform,
  addToQueue, getPendingPosts, markPosted, markFailed, getUserQueue, clearPosted,
};

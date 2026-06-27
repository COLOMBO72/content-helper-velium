// db.js — база данных через sql.js (работает на Windows/Linux/Mac без компилятора)
// sql.js = SQLite скомпилированный в WebAssembly, не требует native build

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data.db');

// sql.js асинхронный при инициализации, но запросы синхронные
// Держим db в памяти и периодически сохраняем на диск
let db;

function initDb() {
  const initSqlJs = require('sql.js');
  return initSqlJs().then((SQL) => {
    // Загружаем существующую БД или создаём новую
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    // Создаём таблицы
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id     INTEGER PRIMARY KEY,
        username        TEXT,
        first_name      TEXT,
        subscribed      INTEGER DEFAULT 0,
        trial_until     INTEGER DEFAULT 0,
        created_at      INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id         INTEGER PRIMARY KEY,
        source_channel  TEXT,
        deepl_key       TEXT,
        setup_done      INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS platforms (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER,
        platform        TEXT NOT NULL,
        enabled         INTEGER DEFAULT 1,
        translate       INTEGER DEFAULT 0,
        credentials     TEXT DEFAULT '{}',
        target          TEXT,
        queue_interval  INTEGER DEFAULT 0,
        created_at      INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS queue (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER,
        platform_id     INTEGER,
        text            TEXT,
        photo_url       TEXT,
        scheduled_at    INTEGER,
        posted          INTEGER DEFAULT 0,
        error_msg       TEXT,
        created_at      INTEGER DEFAULT (strftime('%s','now'))
      );
    `);

    save();
    console.log('[DB] Инициализирована:', DB_PATH);
  });
}

// Сохраняем БД на диск после каждого write-запроса
function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Выполнить SELECT — возвращает массив объектов
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Выполнить SELECT — возвращает первую строку или undefined
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0];
}

// Выполнить INSERT/UPDATE/DELETE
function run(sql, params = []) {
  db.run(sql, params);
  save();
}

// ─── Users ────────────────────────────────────────────────────────

function upsertUser(telegramId, username, firstName) {
  run(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
  `, [telegramId, username || null, firstName || null]);

  run(`INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)`, [telegramId]);
}

function getUser(telegramId) {
  return get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

function isSubscribed(telegramId) {
  // Пока бесплатно — всегда true
  return true;
  // const user = getUser(telegramId);
  // return user && user.subscribed === 1;
}

// ─── Settings ─────────────────────────────────────────────────────

function getSettings(userId) {
  return get('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
}

function updateSettings(userId, fields) {
  const keys = Object.keys(fields);
  const set = keys.map(k => `${k} = ?`).join(', ');
  const values = [...keys.map(k => fields[k]), userId];
  run(`UPDATE user_settings SET ${set} WHERE user_id = ?`, values);
}

// ─── Platforms ────────────────────────────────────────────────────

function getPlatforms(userId) {
  return all('SELECT * FROM platforms WHERE user_id = ?', [userId]);
}

function getPlatform(id) {
  return get('SELECT * FROM platforms WHERE id = ?', [id]);
}

function getPlatformByType(userId, platform) {
  return get('SELECT * FROM platforms WHERE user_id = ? AND platform = ?', [userId, platform]);
}

function upsertPlatform(userId, platform, data) {
  const existing = getPlatformByType(userId, platform);
  if (existing) {
    const keys = Object.keys(data);
    const set = keys.map(k => `${k} = ?`).join(', ');
    run(`UPDATE platforms SET ${set} WHERE id = ?`, [...keys.map(k => data[k]), existing.id]);
    return existing.id;
  } else {
    run(`
      INSERT INTO platforms (user_id, platform, credentials, target, translate, queue_interval, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [userId, platform,
      data.credentials || '{}',
      data.target || null,
      data.translate || 0,
      data.queue_interval || 0
    ]);
    // Получаем id только что вставленной строки
    const row = get('SELECT last_insert_rowid() as id');
    return row ? row.id : null;
  }
}

function togglePlatform(id, enabled) {
  run('UPDATE platforms SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

function deletePlatform(id) {
  run('DELETE FROM platforms WHERE id = ?', [id]);
}

// ─── Queue ────────────────────────────────────────────────────────

function addToQueue(userId, platformId, text, photoUrl, scheduledAt) {
  run(`
    INSERT INTO queue (user_id, platform_id, text, photo_url, scheduled_at)
    VALUES (?, ?, ?, ?, ?)
  `, [userId, platformId, text, photoUrl || null, scheduledAt]);
}

function getPendingPosts(now) {
  return all(`
    SELECT q.*, p.platform, p.credentials, p.target, p.translate, p.queue_interval,
           u.telegram_id
    FROM queue q
    JOIN platforms p ON q.platform_id = p.id
    JOIN users u ON q.user_id = u.telegram_id
    WHERE q.posted = 0 AND q.scheduled_at <= ? AND p.enabled = 1
    ORDER BY q.scheduled_at ASC
  `, [now]);
}

function markPosted(id) {
  run('UPDATE queue SET posted = 1 WHERE id = ?', [id]);
}

function markFailed(id, error) {
  run('UPDATE queue SET posted = 2, error_msg = ? WHERE id = ?', [error, id]);
}

function getUserQueue(userId, limit = 10) {
  return all(`
    SELECT q.*, p.platform, p.target
    FROM queue q
    JOIN platforms p ON q.platform_id = p.id
    WHERE q.user_id = ? AND q.posted = 0
    ORDER BY q.scheduled_at ASC
    LIMIT ?
  `, [userId, limit]);
}

function clearPosted(userId) {
  run('DELETE FROM queue WHERE user_id = ? AND posted = 1', [userId]);
}

// Для migrator.js — прямой запрос
function getAllActiveSettings() {
  return all(`
    SELECT us.user_id as telegram_id, us.source_channel
    FROM user_settings us
    WHERE us.setup_done = 1 AND us.source_channel IS NOT NULL
  `);
}

module.exports = {
  initDb,
  upsertUser, getUser, isSubscribed,
  getSettings, updateSettings,
  getPlatforms, getPlatform, getPlatformByType, upsertPlatform, togglePlatform, deletePlatform,
  addToQueue, getPendingPosts, markPosted, markFailed, getUserQueue, clearPosted,
  getAllActiveSettings,
};

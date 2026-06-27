// scheduler.js — обработчик очереди постов
// Запускается каждую минуту, публикует посты у которых пришло время

const db = require('./db');
const vk = require('./publishers/vk');
const tg = require('./publishers/telegram');
const instagram = require('./publishers/instagram');
const twitter = require('./publishers/twitter');
const deepl = require('./services/deepl');
const fs = require('fs');

// Маппинг платформы → publisher
const PUBLISHERS = {
  vk: vk,
  telegram: tg,
  instagram: instagram,
  twitter: twitter,
};

// Языки перевода для каждой платформы (можно расширять)
const TRANSLATE_LANG = {
  vk: 'RU',
  telegram: 'RU',
  instagram: 'EN-US',
  twitter: 'EN-US',
};

let botInstance = null; // ссылка на TG бот для уведомлений

function init(bot) {
  botInstance = bot;
  // Запускаем проверку каждую минуту
  setInterval(processQueue, 60 * 1000);
  console.log('[Scheduler] Запущен, интервал: 60 сек');
}

async function processQueue() {
  const now = Math.floor(Date.now() / 1000);
  const pending = db.getPendingPosts(now);

  if (pending.length === 0) return;

  console.log(`[Scheduler] Обрабатываю ${pending.length} постов`);

  for (const item of pending) {
    await processItem(item);
  }
}

async function processItem(item) {
  const publisher = PUBLISHERS[item.platform];
  if (!publisher) {
    db.markFailed(item.id, `Неизвестная платформа: ${item.platform}`);
    return;
  }

  try {
    let text = item.text || '';

    // Перевод если нужен
    if (item.translate) {
      const settings = db.getSettings(item.user_id);
      if (settings?.deepl_key) {
        const lang = TRANSLATE_LANG[item.platform] || 'EN-US';
        text = await deepl.translate(text, lang, settings.deepl_key);
        console.log(`[Scheduler] Переведено для ${item.platform}`);
      }
    }

    const postId = await publisher.post({
      text,
      photoPath: item.photo_url,
      credentials: item.credentials,
      target: item.target,
    });

    db.markPosted(item.id);
    console.log(`[Scheduler] ✅ ${item.platform} post_id=${postId}`);

    // Уведомляем пользователя
    if (botInstance) {
      const platformEmoji = { vk: '🔵', telegram: '✈️', instagram: '📸', twitter: '🐦' };
      const emoji = platformEmoji[item.platform] || '📢';
      await botInstance.sendMessage(item.user_id,
        `${emoji} Пост опубликован в <b>${item.platform.toUpperCase()}</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }

    // Чистим фото после публикации во всех платформах
    // (удаляем только если этот файл больше не нужен — проверяем очередь)
    cleanupPhotoIfDone(item.photo_url, item.user_id);

  } catch (err) {
    const errMsg = err.message || String(err);
    db.markFailed(item.id, errMsg);
    console.error(`[Scheduler] ❌ ${item.platform} error: ${errMsg}`);

    // Уведомляем об ошибке
    if (botInstance) {
      await botInstance.sendMessage(item.user_id,
        `❌ Ошибка публикации в <b>${item.platform.toUpperCase()}</b>:\n<code>${errMsg}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }
}

function cleanupPhotoIfDone(photoPath, userId) {
  if (!photoPath || !fs.existsSync(photoPath)) return;
  // Проверяем — нет ли ещё ожидающих постов с этим файлом
  const stillNeeded = db.getUserQueue(userId, 100).some(q => q.photo_url === photoPath);
  if (!stillNeeded) {
    try { fs.unlinkSync(photoPath); } catch {}
  }
}

/**
 * Добавляет пост в очередь для всех активных платформ пользователя
 * @param {number} userId
 * @param {string} text
 * @param {string|null} photoPath
 * @param {object} textReplacements — { 'слово': 'замена' }
 */
function enqueue(userId, text, photoPath, textReplacements = {}) {
  const platforms = db.getPlatforms(userId).filter(p => p.enabled);
  const settings = db.getSettings(userId);

  let processedText = text || '';

  // Применяем замены слов
  for (const [from, to] of Object.entries(textReplacements)) {
    processedText = processedText.split(from).join(to);
  }

  // Также заменяем ссылки на TG канал на ссылки платформ
  if (settings?.source_channel) {
    const channelUsername = settings.source_channel.replace('@', '');
    const tgLink = `t.me/${channelUsername}`;
    // Заменяем на пустую строку — каждая платформа использует свой target
    processedText = processedText.split(`https://${tgLink}`).join('').trim();
    processedText = processedText.split(tgLink).join('').trim();
  }

  const now = Math.floor(Date.now() / 1000);

  for (const platform of platforms) {
    // Вычисляем время публикации с учётом очереди
    let scheduledAt = now;

    if (platform.queue_interval > 0) {
      // Берём время последнего запланированного поста для этой платформы
      const lastInQueue = db.getUserQueue(userId, 100)
        .filter(q => q.platform === platform.platform)
        .sort((a, b) => b.scheduled_at - a.scheduled_at)[0];

      if (lastInQueue) {
        // Следующий пост = после последнего + интервал
        scheduledAt = lastInQueue.scheduled_at + (platform.queue_interval * 60);
      }
    }

    db.addToQueue(userId, platform.id, processedText, photoPath, scheduledAt);

    const minutesFromNow = Math.round((scheduledAt - now) / 60);
    console.log(`[Queue] user=${userId} platform=${platform.platform} delay=${minutesFromNow}m`);
  }

  return platforms.length;
}

module.exports = { init, enqueue, processQueue };

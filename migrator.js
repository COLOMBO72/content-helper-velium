// migrator.js — перенос старых постов из TG канала в ВК
// Запускается отдельно от основного бота: node migrator.js
//
// Алгоритм:
//   1. Загружает посты из TG канала начиная с FROM_DATE
//   2. Каждые INTERVAL_HOURS часов присылает тебе пост на одобрение
//   3. Ты нажимаешь ✅ / ❌ / ⏭
//   4. Сохраняет прогресс — при рестарте продолжает с того же места

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

// ── Настройки ─────────────────────────────────────────────────────
const BOT_TOKEN = process.env.MIGRATOR_BOT_TOKEN;
const YOUR_TG_ID = parseInt(process.env.MIGRATOR_YOUR_TG_ID); // твой личный Telegram ID
const TG_CHANNEL = process.env.MIGRATOR_TG_CHANNEL; // @gta6_join
const VK_TOKEN = process.env.MIGRATOR_VK_TOKEN; // токен VK группы
const VK_GROUP_ID = process.env.MIGRATOR_VK_GROUP_ID; // числовой ID группы VK

// С какой даты брать посты (последние полгода = ~январь 2025)
const FROM_DATE = new Date(
  process.env.MIGRATOR_FROM_DATE || "2025-01-01T00:00:00Z",
);

// Интервал между постами в ВК (в миллисекундах)
const INTERVAL_HOURS = parseFloat(process.env.MIGRATOR_INTERVAL_HOURS || "3");
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

// Файл прогресса — чтобы при рестарте не начинать заново
const PROGRESS_FILE = path.join(__dirname, "migrator_progress.json");
const PHOTOS_DIR = path.join(__dirname, "tmp_photos");

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR);

// ── Проверка конфига ──────────────────────────────────────────────
if (!BOT_TOKEN || !YOUR_TG_ID || !TG_CHANNEL || !VK_TOKEN || !VK_GROUP_ID) {
  console.error(`
❌ Не все переменные заданы в .env!

Нужны:
  BOT_TOKEN               — токен бота (тот же что в основном боте)
  MIGRATOR_YOUR_TG_ID     — твой личный Telegram ID (узнать: @userinfobot)
  MIGRATOR_TG_CHANNEL     — @gta6_join
  MIGRATOR_VK_TOKEN       — токен VK группы
  MIGRATOR_VK_GROUP_ID    — числовой ID группы VK
  MIGRATOR_FROM_DATE      — с какой даты (по умолчанию: 2025-01-01)
  MIGRATOR_INTERVAL_HOURS — интервал в часах (по умолчанию: 3)
`);
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ── Прогресс ─────────────────────────────────────────────────────
// Структура: { posts: [...], currentIndex: N, lastPostedAt: timestamp }
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  }
  return { posts: [], currentIndex: 0, lastPostedAt: 0, loaded: false };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

let progress = loadProgress();
let waitingForApproval = false; // флаг — сейчас ждём ответа от тебя
let pendingPhotoPath = null; // путь к скачанному фото текущего поста
let paused = false; // пауза

// ── Загрузка постов из TG через Bot API ──────────────────────────
// TG Bot API не даёт читать историю канала напрямую.
// Используем getUpdates с большим offset чтобы собрать все channel_post.
// НО: getUpdates хранит только последние ~100 апдейтов.
//
// Решение: используем forwardMessages — бот пересылает посты себе в личку
// и мы их там читаем. Или используем MTProto через gramjs.
//
// Самый простой способ без MTProto:
// Пользователь вручную пересылает диапазон постов боту — бот их собирает.
//
// Реализуем через /load команду — объясняем пользователю что нужно сделать.

// ── Команды управления ────────────────────────────────────────────

bot.onText(/\/start|\/help/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  sendHelp(msg.chat.id);
});

function sendHelp(chatId) {
  bot.sendMessage(
    chatId,
    `<b>🔄 Migrator — перенос постов TG → ВК</b>\n\n` +
      `<b>Как загрузить посты:</b>\n` +
      `1. Открой свой канал ${TG_CHANNEL}\n` +
      `2. Выдели нужные посты (долгое нажатие)\n` +
      `3. Перешли их этому боту\n` +
      `Бот соберёт их и начнёт показывать на одобрение.\n\n` +
      `<b>Команды:</b>\n` +
      `/status — сколько постов загружено и где прогресс\n` +
      `/next — показать следующий пост прямо сейчас\n` +
      `/pause — поставить на паузу\n` +
      `/resume — продолжить\n` +
      `/skip N — пропустить N постов\n` +
      `/reset — сбросить весь прогресс\n` +
      `/help — эта справка\n\n` +
      `<b>Текущие настройки:</b>\n` +
      `📅 Фильтр с: ${FROM_DATE.toLocaleDateString("ru-RU")}\n` +
      `⏱ Интервал: каждые ${INTERVAL_HOURS} часа\n` +
      `📊 Постов загружено: ${progress.posts.length}\n` +
      `📍 Текущий индекс: ${progress.currentIndex}`,
    { parse_mode: "HTML" },
  );
}

bot.onText(/\/status/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  const remaining = progress.posts.length - progress.currentIndex;
  const daysLeft = Math.round((remaining * INTERVAL_HOURS) / 24);
  const lastAt = progress.lastPostedAt
    ? new Date(progress.lastPostedAt).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
      })
    : "ещё не было";

  bot.sendMessage(
    msg.chat.id,
    `<b>📊 Статус миграции</b>\n\n` +
      `Загружено постов: <b>${progress.posts.length}</b>\n` +
      `Опубликовано: <b>${progress.currentIndex}</b>\n` +
      `Осталось: <b>${remaining}</b>\n` +
      `Примерно дней: <b>${daysLeft}</b>\n` +
      `Последняя публикация: ${lastAt}\n` +
      `Статус: ${paused ? "⏸ Пауза" : waitingForApproval ? "⏳ Ждёт одобрения" : "▶️ Активен"}`,
    { parse_mode: "HTML" },
  );
});

bot.onText(/\/pause/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  paused = true;
  bot.sendMessage(
    msg.chat.id,
    "⏸ Миграция поставлена на паузу.\n\nНапиши /resume чтобы продолжить.",
  );
});

bot.onText(/\/resume/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  paused = false;
  bot.sendMessage(
    msg.chat.id,
    "▶️ Продолжаем! Следующий пост придёт по расписанию.",
  );
  scheduleNext(true);
});

bot.onText(/\/next/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  if (waitingForApproval) {
    bot.sendMessage(
      msg.chat.id,
      "⏳ Сначала одобри или пропусти текущий пост.",
    );
    return;
  }
  sendNextPost(msg.chat.id);
});

bot.onText(/\/skip (\d+)/, (msg, match) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  const n = parseInt(match[1]);
  progress.currentIndex = Math.min(
    progress.currentIndex + n,
    progress.posts.length,
  );
  saveProgress(progress);
  bot.sendMessage(
    msg.chat.id,
    `⏭ Пропущено ${n} постов. Текущий индекс: ${progress.currentIndex}`,
  );
});

bot.onText(/\/reset/, (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;
  bot.sendMessage(
    msg.chat.id,
    "⚠️ Ты уверен? Это сбросит весь прогресс и список постов.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Да, сбросить", callback_data: "mg_reset_confirm" },
            { text: "❌ Отмена", callback_data: "mg_cancel" },
          ],
        ],
      },
    },
  );
});

// ── Получение пересланных постов от пользователя ──────────────────
// Пользователь пересылает посты из канала — бот их собирает
bot.on("message", (msg) => {
  if (msg.from.id !== YOUR_TG_ID) return;

  // Игнорируем команды
  if (msg.text && msg.text.startsWith("/")) return;

  // Это пересланный пост из канала?
  const fwdChat = msg.forward_from_chat || msg.forward_origin?.chat;
  if (!fwdChat) return;

  // Проверяем что это наш канал
  const channelUsername = fwdChat.username
    ? `@${fwdChat.username}`
    : String(fwdChat.id);
  const targetChannel = TG_CHANNEL.toLowerCase();
  if (channelUsername.toLowerCase() !== targetChannel) {
    bot.sendMessage(msg.chat.id, `⚠️ Это пост не из ${TG_CHANNEL}, игнорирую.`);
    return;
  }

  // Проверяем дату
  const postDate = new Date((msg.forward_date || msg.date) * 1000);
  if (postDate < FROM_DATE) {
    // Молча игнорируем старые посты
    return;
  }

  // Пропускаем опросы — в ВК они всё равно не работают
  if (msg.poll) {
    bot.sendMessage(
      msg.chat.id,
      `⏭ Пост с опросом пропущен (в ВК не поддерживается)`,
    );
    return;
  }

  // Извлекаем данные поста
  const postData = {
    text: msg.text || msg.caption || "",
    date: postDate.toISOString(),
    messageId: msg.message_id,
    hasPhoto: !!msg.photo,
    photoFileId: msg.photo ? msg.photo[msg.photo.length - 1].file_id : null,
  };

  // Проверяем дубликаты
  const isDuplicate = progress.posts.some(
    (p) => p.messageId === postData.messageId,
  );
  if (isDuplicate) return;

  progress.posts.push(postData);
  saveProgress(progress);

  // Тихо принимаем, каждые 10 постов сообщаем
  if (progress.posts.length % 10 === 0) {
    bot.sendMessage(
      msg.chat.id,
      `✅ Собрано постов: <b>${progress.posts.length}</b>\n` +
        `Продолжай пересылать или напиши /next чтобы начать.`,
      { parse_mode: "HTML" },
    );
  }
});

// ── Отправка поста на одобрение ───────────────────────────────────
async function sendNextPost(chatId) {
  if (progress.currentIndex >= progress.posts.length) {
    bot.sendMessage(
      chatId,
      `🎉 <b>Все посты просмотрены!</b>\n\n` +
        `Опубликовано: ${progress.currentIndex} из ${progress.posts.length}\n\n` +
        `Если хочешь добавить ещё посты — пересылай их боту.`,
      { parse_mode: "HTML" },
    );
    waitingForApproval = false;
    return;
  }

  const post = progress.posts[progress.currentIndex];
  waitingForApproval = true;

  const postDate = new Date(post.date).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const header =
    `<b>📋 Пост ${progress.currentIndex + 1} из ${progress.posts.length}</b>\n` +
    `📅 ${postDate}\n` +
    `━━━━━━━━━━━━━━━━\n`;

  const footer = `\n━━━━━━━━━━━━━━━━\n` + `Что делаем с этим постом?`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Публиковать в ВК", callback_data: "mg_approve" },
        { text: "❌ Пропустить", callback_data: "mg_skip" },
      ],
      [
        { text: "⏸ Пауза", callback_data: "mg_pause" },
        { text: "📊 Статус", callback_data: "mg_status" },
      ],
    ],
  };

  try {
    if (post.hasPhoto && post.photoFileId) {
      // Скачиваем фото
      const fileInfo = await bot.getFile(post.photoFileId);
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
      pendingPhotoPath = path.join(PHOTOS_DIR, `migrator_${Date.now()}.jpg`);
      await downloadFile(fileUrl, pendingPhotoPath);

      const caption =
        header +
        (post.text ? post.text.slice(0, 800) : "(без текста)") +
        footer;
      await bot.sendPhoto(chatId, pendingPhotoPath, {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } else {
      // Только текст
      const text =
        header +
        (post.text ? post.text.slice(0, 3000) : "(пустой пост)") +
        footer;
      await bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
  } catch (e) {
    console.error("[Migrator] Ошибка отправки поста:", e.message);
    // Пропускаем проблемный пост автоматически
    bot.sendMessage(
      chatId,
      `⚠️ Не удалось загрузить пост ${progress.currentIndex + 1}, пропускаю...`,
    );
    progress.currentIndex++;
    saveProgress(progress);
    waitingForApproval = false;
    scheduleNext(false);
  }
}

// ── Callback кнопок одобрения ─────────────────────────────────────
bot.on("callback_query", async (query) => {
  if (query.from.id !== YOUR_TG_ID) return;
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (data === "mg_cancel") return;

  if (data === "mg_reset_confirm") {
    progress = { posts: [], currentIndex: 0, lastPostedAt: 0, loaded: false };
    saveProgress(progress);
    waitingForApproval = false;
    bot.sendMessage(
      chatId,
      "🔄 Прогресс сброшен. Пересылай посты боту заново.",
    );
    return;
  }

  if (data === "mg_status") {
    const remaining = progress.posts.length - progress.currentIndex;
    bot.sendMessage(chatId, `📊 Осталось: <b>${remaining}</b> постов`, {
      parse_mode: "HTML",
    });
    return;
  }

  if (data === "mg_pause") {
    paused = true;
    waitingForApproval = false;
    bot
      .editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: query.message.message_id,
        },
      )
      .catch(() => {});
    bot.sendMessage(chatId, "⏸ Пауза. Напиши /resume чтобы продолжить.");
    return;
  }

  if (data === "mg_skip") {
    // Чистим фото
    cleanupPhoto();
    progress.currentIndex++;
    saveProgress(progress);
    waitingForApproval = false;

    bot
      .editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: query.message.message_id,
        },
      )
      .catch(() => {});

    bot.sendMessage(
      chatId,
      `⏭ Пропущено. Следующий пост придёт через <b>${INTERVAL_HOURS} ч</b>`,
      { parse_mode: "HTML" },
    );
    scheduleNext(false);
    return;
  }

  if (data === "mg_approve") {
    // Публикуем в ВК
    const post = progress.posts[progress.currentIndex];
    waitingForApproval = false;

    bot
      .editMessageReplyMarkup(
        { inline_keyboard: [] },
        {
          chat_id: chatId,
          message_id: query.message.message_id,
        },
      )
      .catch(() => {});

    bot.sendMessage(chatId, "⏳ Публикую в ВК...");

    try {
      const postId = await postToVK(post.text);
      cleanupPhoto();
      progress.currentIndex++;
      progress.lastPostedAt = Date.now();
      saveProgress(progress);

      bot.sendMessage(
        chatId,
        `✅ <b>Опубликовано в ВК!</b>\n` +
          `post_id: ${postId}\n\n` +
          `Следующий пост через <b>${INTERVAL_HOURS} ч</b>`,
        { parse_mode: "HTML" },
      );
      scheduleNext(false);
    } catch (e) {
      bot.sendMessage(
        chatId,
        `❌ <b>Ошибка публикации в ВК:</b>\n<code>${e.message}</code>\n\nПопробуй ещё раз или пропусти пост.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🔄 Повторить", callback_data: "mg_approve" },
                { text: "❌ Пропустить", callback_data: "mg_skip" },
              ],
            ],
          },
        },
      );
      waitingForApproval = true;
    }
    return;
  }
});

// ── Публикация в ВК ───────────────────────────────────────────────
const VK_API = "https://api.vk.com/method";
const VK_V = "5.131";

// async function postToVK(text, photoPath) {
//   let attachment = null;

//   if (photoPath && fs.existsSync(photoPath)) {
//     const serverRes = await axios.post(
//       `${VK_API}/photos.getWallUploadServer`,
//       new URLSearchParams({
//         group_id: VK_GROUP_ID,
//         access_token: VK_TOKEN,
//         v: VK_V,
//       }),
//     );
//     if (serverRes.data.error) throw new Error(serverRes.data.error.error_msg);

//     const form = new FormData();
//     form.append("photo", fs.createReadStream(photoPath));
//     const uploadRes = await axios.post(
//       serverRes.data.response.upload_url,
//       form,
//       {
//         headers: form.getHeaders(),
//         maxContentLength: Infinity,
//         maxBodyLength: Infinity,
//       },
//     );

//     const saveRes = await axios.post(
//       `${VK_API}/photos.saveWallPhoto`,
//       new URLSearchParams({
//         group_id: VK_GROUP_ID,
//         photo: uploadRes.data.photo,
//         server: String(uploadRes.data.server),
//         hash: uploadRes.data.hash,
//         access_token: VK_TOKEN,
//         v: VK_V,
//       }),
//     );
//     if (saveRes.data.error) throw new Error(saveRes.data.error.error_msg);

//     const p = saveRes.data.response[0];
//     attachment = `photo${p.owner_id}_${p.id}`;
//   }

//   const wallRes = await axios.post(
//     `${VK_API}/wall.post`,
//     new URLSearchParams({
//       owner_id: `-${VK_GROUP_ID}`,
//       from_group: "1",
//       message: text || "",
//       ...(attachment ? { attachments: attachment } : {}),
//       access_token: VK_TOKEN,
//       v: VK_V,
//     }),
//   );
//   if (wallRes.data.error) throw new Error(wallRes.data.error.error_msg);

//   return wallRes.data.response.post_id;
// }

// === закомментировал для будущего использования, если нужно будет публиковать в ВК с фото и разблокируют тг

async function postToVK(text) {
  const wallRes = await axios.post(
    `${VK_API}/wall.post`,
    new URLSearchParams({
      owner_id: `-${VK_GROUP_ID}`,
      from_group: "1",
      message: text || "",
      access_token: VK_TOKEN,
      v: VK_V,
    }),
  );
  if (wallRes.data.error) throw new Error(wallRes.data.error.error_msg);
  return wallRes.data.response.post_id;
}

// ── Планировщик следующего поста ──────────────────────────────────

let scheduleTimer = null;

function scheduleNext(immediately) {
  if (scheduleTimer) clearTimeout(scheduleTimer);
  if (paused) return;

  const delay = immediately ? 2000 : INTERVAL_MS;
  const label = immediately ? "сейчас" : `через ${INTERVAL_HOURS} ч`;
  console.log(`[Migrator] Следующий пост ${label}`);

  scheduleTimer = setTimeout(() => {
    if (!paused && !waitingForApproval && progress.posts.length > 0) {
      sendNextPost(YOUR_TG_ID);
    }
  }, delay);
}

// ── Вспомогательные ───────────────────────────────────────────────
async function downloadFile(url, dest) {
  const response = await axios.get(url, { responseType: "stream" });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

function cleanupPhoto() {
  if (pendingPhotoPath && fs.existsSync(pendingPhotoPath)) {
    try {
      fs.unlinkSync(pendingPhotoPath);
    } catch {}
  }
  pendingPhotoPath = null;
}

bot.on("polling_error", (err) => {
  console.error("[POLLING ERROR]", err.code, err.message);
});

// ── Старт ─────────────────────────────────────────────────────────
console.log("🔄 Migrator запущен!");
console.log(`   Канал: ${TG_CHANNEL}`);
console.log(`   Фильтр с: ${FROM_DATE.toLocaleDateString("ru-RU")}`);
console.log(`   Интервал: ${INTERVAL_HOURS} ч`);
console.log(`   Постов в базе: ${progress.posts.length}`);
console.log(`   Текущий индекс: ${progress.currentIndex}`);

// Отправляем приветствие себе
setTimeout(() => {
  bot
    .sendMessage(
      YOUR_TG_ID,
      `<b>🔄 Migrator запущен!</b>\n\n` +
        (progress.posts.length > 0
          ? `В базе уже <b>${progress.posts.length}</b> постов, продолжаю с #${progress.currentIndex + 1}\n\nНапиши /next чтобы начать или /resume если была пауза.`
          : `Постов пока нет.\n\n<b>Как загрузить посты:</b>\n1. Открой канал ${TG_CHANNEL}\n2. Выдели посты за нужный период\n3. Перешли их сюда в этот чат\n\nПосты с опросами будут автоматически пропущены.`),
      { parse_mode: "HTML" },
    )
    .catch((e) =>
      console.error(
        "Не могу написать тебе в личку. Убедись что ты написал боту /start",
      ),
    );

  // Если есть посты и не на паузе — запускаем расписание
  if (
    progress.posts.length > 0 &&
    progress.currentIndex < progress.posts.length
  ) {
    scheduleNext(false);
  }
}, 2000);

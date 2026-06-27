# 🚀 Content Helper Velium

Telegram бот для автоматического постинга из TG канала во все соцсети.

**By Velium Group • velium.ru**

---

## Что умеет

- 📡 Читает посты из твоего TG канала
- 🔵 Публикует в VK группу
- ✈️ Репостит в другой TG канал
- 📸 Постит в Instagram (нужен Meta App Review)
- 🐦 Твитит в X/Twitter (нужен платный X API)
- 🌐 Переводит тексты через DeepL
- ⏱ Очередь с настраиваемым интервалом
- 👥 Мультипользовательский — каждый вводит свои ключи

---

## Быстрый старт

```bash
git clone ...
cd content-helper-velium
npm install
cp .env.example .env
nano .env          # вставь BOT_TOKEN
node bot.js
```

### На VPS через PM2

```bash
npm install
cp .env.example .env
nano .env
pm2 start bot.js --name content-helper-velium
pm2 save
pm2 logs content-helper-velium
```

---

## Единственный токен для запуска

В `.env` нужен только **BOT_TOKEN** — токен самого бота.

Получить: @BotFather → /newbot

Все остальные токены (VK, Instagram, DeepL и т.д.) каждый пользователь вводит сам через бота в разделе **📡 Мои платформы**.

---

## Настройка для пользователей

1. Написать боту `/start`
2. Нажать **⚙️ Настройки** → указать свой TG канал-источник
3. Добавить бота как **администратора** в свой TG канал
4. Нажать **📡 Мои платформы** → подключить нужные платформы
5. Публиковать посты в TG канал — бот сам разнесёт везде

---

## Токены для каждой платформы

### VK
- Управление группой → Работа с API → Создать ключ
- Права: `wall` + `photos` + `groups`
- VK_GROUP_ID — числа из URL группы (vk.com/club**123456789**)

### Telegram канал
- Создать бота через @BotFather
- Добавить его как администратора в целевой канал
- Channel ID: @username или числовой ID

### Instagram
- Нужен Instagram Business аккаунт
- Привязать к Facebook Page
- Создать Meta Developer App
- Пройти App Review (~2-4 недели)
- Получить Access Token + IG User ID

### Twitter/X
- Нужен платный X API ($100/мес у X, не у нас)
- developer.twitter.com → проект → ключи
- Нужны: API Key, API Secret, Access Token, Access Token Secret

### DeepL (перевод)
- Бесплатно до 500к символов/мес
- deepl.com/pro-api → Free plan
- Ключ формата: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx`

---

## Включение оплаты (ЮКасса)

Когда будешь готов включить платный доступ:

1. В `db.js` — в функции `isSubscribed()` убери `return true`, раскомментируй логику
2. В `middleware/auth.js` — раскомментируй блок проверки подписки
3. В `handlers/subscribe.js` — раскомментируй блок YooKassa
4. Добавь в `.env`: `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`
5. `npm install @a2seven/yoo-checkout`

---

## Структура проекта

```
bot.js              — точка входа
db.js               — SQLite база данных
scheduler.js        — обработчик очереди
publishers/
  vk.js             — VK
  telegram.js       — Telegram
  instagram.js      — Instagram
  twitter.js        — Twitter/X
services/
  deepl.js          — перевод DeepL
handlers/
  start.js          — /start, главный экран
  setup.js          — мастер настройки
  platforms.js      — управление платформами
  queue.js          — очередь постов
  subscribe.js      — подписка (заглушка ЮКасса)
middleware/
  auth.js           — проверка подписки
```

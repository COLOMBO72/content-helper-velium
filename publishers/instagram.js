// publishers/instagram.js — публикация в Instagram через Meta Graph API
// Credentials: { access_token, ig_user_id }
//
// ⚠️  Требования (пользователь делает сам):
//   1. Instagram Business или Creator аккаунт
//   2. Привязан к Facebook Page
//   3. Meta Developer App с разрешением instagram_content_publish
//   4. Пройденный App Review (~2-4 недели)
//
// Фото должно быть доступно по публичному URL (не локальный путь).
// Бот загружает фото на временный хостинг перед отправкой в Instagram.

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Загружает локальное фото на временный публичный хостинг (0x0.st)
 * Бесплатный, без регистрации, файл живёт 30 дней
 */
async function uploadToTempHost(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  const res = await axios.post('https://0x0.st', form, {
    headers: form.getHeaders(),
  });
  return res.data.trim(); // возвращает публичный URL
}

async function post({ text, photoPath, credentials }) {
  const creds = JSON.parse(credentials);
  const { access_token, ig_user_id } = creds;

  if (!access_token || !ig_user_id) {
    throw new Error('Instagram: не указан access_token или ig_user_id');
  }

  let imageUrl = null;

  if (photoPath && fs.existsSync(photoPath)) {
    // Instagram API требует публичный URL, не локальный файл
    imageUrl = await uploadToTempHost(photoPath);
  }

  if (!imageUrl) {
    throw new Error('Instagram: фото обязательно для публикации');
  }

  // Шаг 1: создаём контейнер
  const containerRes = await axios.post(`${GRAPH}/${ig_user_id}/media`, null, {
    params: {
      image_url: imageUrl,
      caption: text || '',
      access_token,
    },
  });

  if (containerRes.data.error) {
    throw new Error(`Instagram container: ${containerRes.data.error.message}`);
  }

  const containerId = containerRes.data.id;

  // Шаг 2: публикуем контейнер
  const publishRes = await axios.post(`${GRAPH}/${ig_user_id}/media_publish`, null, {
    params: {
      creation_id: containerId,
      access_token,
    },
  });

  if (publishRes.data.error) {
    throw new Error(`Instagram publish: ${publishRes.data.error.message}`);
  }

  return publishRes.data.id;
}

async function validateCredentials(credentials) {
  try {
    const creds = JSON.parse(credentials);
    const res = await axios.get(`${GRAPH}/${creds.ig_user_id}`, {
      params: {
        fields: 'id,name',
        access_token: creds.access_token,
      },
    });
    return !!res.data.id;
  } catch {
    return false;
  }
}

module.exports = { post, validateCredentials };

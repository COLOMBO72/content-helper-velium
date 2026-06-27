// publishers/twitter.js — публикация в Twitter/X
// Credentials: { bearer_token, api_key, api_secret, access_token, access_token_secret }
//
// ⚠️  X API платный: Basic план $100/мес (пользователь платит сам и вставляет свои ключи)
//     Нужен Basic или выше для media upload + posting
//
// Используем Twitter API v2 для текста + v1.1 для загрузки медиа (media/upload)

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const crypto = require('crypto');

/**
 * Генерирует OAuth 1.0a заголовок для Twitter API v1.1
 */
function buildOAuthHeader(method, url, params, creds) {
  const oauthParams = {
    oauth_consumer_key: creds.api_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.access_token,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const sigBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  const sigKey = `${encodeURIComponent(creds.api_secret)}&${encodeURIComponent(creds.access_token_secret)}`;
  const signature = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');
  oauthParams.oauth_signature = signature;

  const header = 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return header;
}

/**
 * Загружает медиа через Twitter v1.1 API
 */
async function uploadMedia(filePath, creds) {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const fileData = fs.readFileSync(filePath);
  const base64Data = fileData.toString('base64');
  const mediaType = 'image/jpeg';

  const params = { media_data: base64Data, media_category: 'tweet_image' };
  const oauthHeader = buildOAuthHeader('POST', url, {}, creds);

  const form = new FormData();
  form.append('media_data', base64Data);
  form.append('media_category', 'tweet_image');

  const res = await axios.post(url, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: oauthHeader,
    },
  });

  return res.data.media_id_string;
}

/**
 * Публикует твит через Twitter API v2
 */
async function post({ text, photoPath, credentials }) {
  const creds = JSON.parse(credentials);
  const { api_key, api_secret, access_token, access_token_secret } = creds;

  if (!api_key || !api_secret || !access_token || !access_token_secret) {
    throw new Error('Twitter: не все ключи указаны (нужны api_key, api_secret, access_token, access_token_secret)');
  }

  const tweetBody = { text: text || '' };

  // Загружаем медиа если есть фото
  if (photoPath && fs.existsSync(photoPath)) {
    const mediaId = await uploadMedia(photoPath, creds);
    tweetBody.media = { media_ids: [mediaId] };
  }

  const url = 'https://api.twitter.com/2/tweets';
  const oauthHeader = buildOAuthHeader('POST', url, {}, creds);

  const res = await axios.post(url, tweetBody, {
    headers: {
      Authorization: oauthHeader,
      'Content-Type': 'application/json',
    },
  });

  return res.data.data.id;
}

async function validateCredentials(credentials) {
  try {
    const creds = JSON.parse(credentials);
    const url = 'https://api.twitter.com/2/users/me';
    const oauthHeader = buildOAuthHeader('GET', url, {}, creds);
    const res = await axios.get(url, {
      headers: { Authorization: oauthHeader },
    });
    return !!res.data.data?.id;
  } catch {
    return false;
  }
}

module.exports = { post, validateCredentials };

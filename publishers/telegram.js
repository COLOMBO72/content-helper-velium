// publishers/telegram.js — репост в другой Telegram канал
// Credentials: { bot_token, channel_id }
// channel_id: @username или числовой ID

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function post({ text, photoPath, credentials }) {
  const creds = JSON.parse(credentials);
  const { bot_token, channel_id } = creds;

  if (!bot_token || !channel_id) throw new Error('Telegram: не указан bot_token или channel_id');

  const base = `https://api.telegram.org/bot${bot_token}`;

  if (photoPath && fs.existsSync(photoPath)) {
    // Отправляем фото с подписью
    const form = new FormData();
    form.append('chat_id', channel_id);
    form.append('photo', fs.createReadStream(photoPath));
    if (text) form.append('caption', text);
    form.append('parse_mode', 'HTML');

    const res = await axios.post(`${base}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
    if (!res.data.ok) throw new Error(`TG sendPhoto: ${res.data.description}`);
    return res.data.result.message_id;
  } else {
    // Только текст
    const res = await axios.post(`${base}/sendMessage`, {
      chat_id: channel_id,
      text: text || '',
      parse_mode: 'HTML',
    });
    if (!res.data.ok) throw new Error(`TG sendMessage: ${res.data.description}`);
    return res.data.result.message_id;
  }
}

async function validateCredentials(credentials) {
  try {
    const creds = JSON.parse(credentials);
    const res = await axios.get(`https://api.telegram.org/bot${creds.bot_token}/getMe`);
    return res.data.ok === true;
  } catch {
    return false;
  }
}

module.exports = { post, validateCredentials };

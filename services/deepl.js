// services/deepl.js — перевод текста через DeepL API
// Каждый пользователь вставляет свой DeepL ключ в настройках

const axios = require('axios');

/**
 * Переводит текст через DeepL
 * @param {string} text — исходный текст
 * @param {string} targetLang — язык цели: 'EN-US', 'RU', 'DE' и т.д.
 * @param {string} apiKey — DeepL API ключ пользователя
 * @returns {Promise<string>} — переведённый текст
 */
async function translate(text, targetLang = 'EN-US', apiKey) {
  if (!apiKey) throw new Error('DeepL API key не указан');
  if (!text || text.trim() === '') return text;

  // DeepL Free API: api-free.deepl.com
  // DeepL Pro API:  api.deepl.com
  // Определяем по суффиксу ключа (:fx = Free)
  const isFree = apiKey.endsWith(':fx');
  const baseUrl = isFree
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  const response = await axios.post(baseUrl,
    new URLSearchParams({
      text,
      target_lang: targetLang,
    }),
    {
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  return response.data.translations[0].text;
}

/**
 * Проверяет что ключ DeepL рабочий
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
async function validateKey(apiKey) {
  try {
    const isFree = apiKey.endsWith(':fx');
    const baseUrl = isFree
      ? 'https://api-free.deepl.com/v2/usage'
      : 'https://api.deepl.com/v2/usage';

    const response = await axios.get(baseUrl, {
      headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}` },
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

module.exports = { translate, validateKey };

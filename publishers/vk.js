// publishers/vk.js — публикация постов в ВКонтакте
// Credentials: { token, group_id }

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.131";

async function uploadPhoto(filePath, token, groupId) {
  // 1. Получаем upload URL
  const serverRes = await axios.get(`${VK_API}/photos.getWallUploadServer`, {
    params: { access_token: token, v: VK_VERSION },
  });
  if (serverRes.data.error)
    throw new Error(`VK: ${serverRes.data.error.error_msg}`);
  const uploadUrl = serverRes.data.response.upload_url;

  // 2. Загружаем файл
  const form = new FormData();
  form.append("photo", fs.createReadStream(filePath));
  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // 3. Сохраняем фото
  const saveRes = await axios.get(`${VK_API}/photos.saveWallPhoto`, {
    params: {
      group_id: groupId,
      photo: uploadRes.data.photo,
      server: uploadRes.data.server,
      hash: uploadRes.data.hash,
      access_token: token,
      v: VK_VERSION,
    },
  });
  if (saveRes.data.error)
    throw new Error(`VK savePhoto: ${saveRes.data.error.error_msg}`);

  const photo = saveRes.data.response[0];
  return `photo${photo.owner_id}_${photo.id}`;
}

// async function post({ text, photoPath, credentials }) {
//   const creds = JSON.parse(credentials);
//   const { token, group_id } = creds;

//   if (!token || !group_id) throw new Error("VK: не указан token или group_id");

//   let attachment = null;
//   if (photoPath && fs.existsSync(photoPath)) {
//     attachment = await uploadPhoto(photoPath, token, group_id);
//   }

//   const params = {
//     owner_id: `-${group_id}`,
//     from_group: 1,
//     message: text || "",
//     access_token: token,
//     v: VK_VERSION,
//   };
//   if (attachment) params.attachments = attachment;

//   const res = await axios.get(`${VK_API}/wall.post`, { params });
//   if (res.data.error)
//     throw new Error(`VK wall.post: ${res.data.error.error_msg}`);

//   return res.data.response.post_id;
// }

// Проверка токена — пробуем получить инфо о группе

async function post({ text, credentials }) {
  const creds = JSON.parse(credentials);
  const { token, group_id } = creds;

  if (!token || !group_id) throw new Error("VK: не указан token или group_id");

  const res = await axios.post(
    `${VK_API}/wall.post`,
    new URLSearchParams({
      owner_id: `-${group_id}`,
      from_group: "1",
      message: text || "",
      access_token: token,
      v: VK_VERSION,
    }),
  );
  if (res.data.error)
    throw new Error(`VK wall.post: ${res.data.error.error_msg}`);

  return res.data.response.post_id;
}

async function validateCredentials(credentials) {
  try {
    const creds = JSON.parse(credentials);
    const res = await axios.get(`${VK_API}/groups.getById`, {
      params: {
        group_id: creds.group_id,
        access_token: creds.token,
        v: VK_VERSION,
      },
    });
    return !res.data.error;
  } catch {
    return false;
  }
}

module.exports = { post, validateCredentials };

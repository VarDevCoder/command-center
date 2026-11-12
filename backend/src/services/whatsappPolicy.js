// Reglas del canal de WhatsApp: Violet solo atiende el chat "Mensajes a mí mismo".
const PHONE_JID = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/;
const LID_JID = /^(\d+)(?::\d+)?@lid$/;
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
const MAX_MESSAGE_AGE_SECONDS = 300;
const MAX_MESSAGE_CHARS = 3500;

// Todo lo que sale lleva esta marca y lo que la trae se descarta: como las respuestas
// llegan al mismo chat, sin ella Violet se contestaría sola y podría autoconfirmarse.
export const VIOLET_MARKER = '🟣 Violet';

export function phoneFromJid(jid) {
  return jid?.match(PHONE_JID)?.[1] ?? null;
}

export function ownChatJids(user) {
  const phone = phoneFromJid(user?.id);
  const lid = user?.lid?.match(LID_JID)?.[1];
  return [phone && `${phone}@s.whatsapp.net`, lid && `${lid}@lid`].filter(Boolean);
}

// fromMe no alcanza: también es true en lo que le mandás a un amigo. Y remoteJidAlt no sirve:
// en mensajes propios describe al remitente (vos), no al chat. Manda el chat, exacto.
export function isOwnChatMessage(message, user, nowSeconds = Date.now() / 1000) {
  const { key, messageTimestamp } = message ?? {};
  if (!key?.id || key.fromMe !== true || !ownChatJids(user).includes(key.remoteJid)) return false;
  // Una orden vieja entregada al reconectar no debe ejecutarse.
  const sentAt = Number(messageTimestamp);
  return Number.isFinite(sentAt) && nowSeconds - sentAt <= MAX_MESSAGE_AGE_SECONDS;
}

export function extractText(content) {
  return (content?.conversation ?? content?.extendedTextMessage?.text ?? '').trim();
}

export function isMedia(content) {
  return MEDIA_TYPES.some((type) => content?.[type]);
}

export function splitMessage(text, maxChars = MAX_MESSAGE_CHARS) {
  const parts = [];
  let rest = String(text ?? '').trim();
  while (rest.length > maxChars) {
    const newline = rest.lastIndexOf('\n', maxChars);
    const cut = newline > maxChars / 2 ? newline : maxChars;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

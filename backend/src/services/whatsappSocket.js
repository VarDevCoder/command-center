// Conexión a WhatsApp como dispositivo vinculado: sale de esta PC y no abre puertos.
// Las claves viven fuera del repo y equivalen a tu sesión de WhatsApp.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '../utils/paths.js';

const AUTH_DIR = join(PATHS.claudeDir, '..', 'command-center-data', 'whatsapp', 'auth');

const silentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

export async function isLinked() {
  try {
    // `account` recién existe cuando el celular aceptó: un intento a medias no cuenta como vinculado.
    const creds = JSON.parse(await readFile(join(AUTH_DIR, 'creds.json'), 'utf8'));
    return Boolean(creds.me?.id && creds.account);
  } catch {
    return false;
  }
}

// Un intento de vinculación a medias deja credenciales que WhatsApp rechaza con 401 en el siguiente.
export async function discardUnfinishedLink() {
  if (!(await isLinked())) await rm(AUTH_DIR, { recursive: true, force: true });
}

/**
 * La librería se carga recién acá: sin WhatsApp vinculado, el backend ni la importa.
 */
export async function connectWhatsApp({ onConnectionUpdate, onMessages }) {
  const baileys = await import('@whiskeysockets/baileys');
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, Browsers } = baileys;

  await mkdir(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  let version;
  try {
    ({ version } = await fetchLatestWaWebVersion());
  } catch { /* sin versión remota se usa la que trae la librería */ }

  const socket = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: silentLogger,
    // Tiene que ser un navegador que WhatsApp conozca: con otro nombre rechaza la vinculación por código.
    browser: Browsers.windows('Chrome'),
    // Si figurara "en línea", tu celular dejaría de mostrar notificaciones.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // No traemos chats: esta PC solo necesita las órdenes nuevas.
    shouldSyncHistoryMessage: () => false,
    getMessage: async () => undefined,
  });

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', (update) => onConnectionUpdate?.(update, socket));
  if (onMessages) socket.ev.on('messages.upsert', onMessages);
  return socket;
}

export async function normalizeContent(message) {
  const { normalizeMessageContent } = await import('@whiskeysockets/baileys');
  return normalizeMessageContent(message);
}

// Canal de WhatsApp de Violet: solo el chat "Mensajes a mí mismo", compartiendo conversación con la web.
import { createLogger } from '../utils/logger.js';
import {
  VIOLET_MARKER,
  extractText,
  isMedia,
  isOwnChatMessage,
  ownChatJids,
  splitMessage,
} from './whatsappPolicy.js';
import { connectWhatsApp, isLinked, normalizeContent } from './whatsappSocket.js';

const log = createLogger('WhatsApp');

const MAX_SEEN_IDS = 500;
const MAX_RECONNECT_MS = 5 * 60 * 1000;
// Sesión cerrada, reemplazada por otra o bloqueada: reintentar solo empeora las cosas.
const FATAL_DISCONNECT_CODES = new Set([401, 403, 440]);

export class WhatsAppService {
  constructor({ connect = connectWhatsApp, linked = isLinked, normalize = normalizeContent } = {}) {
    this.connect = connect;
    this.linked = linked;
    this.normalize = normalize;
    this.socket = null;
    this.user = null;
    this.chatJid = null;
    this.open = false;
    this.outbox = [];
    this.seen = new Set();
    this.reconnectDelay = 5000;
  }

  async start({ violet, agentManager }) {
    if (!(await this.linked())) {
      log.info('Desactivado: no hay un WhatsApp vinculado');
      return false;
    }

    this.violet = violet;
    this.agentManager = agentManager;

    violet.on('message', (message) => {
      if (message.role === 'violet' && (!message.channel || message.channel === 'whatsapp')) {
        this._send(message.text);
      }
    });
    violet.on('confirmationRequired', ({ summary }) => {
      this._send(`Quiero hacer esto:\n\n${summary}\n\n¿Autorizás? Sí / No`);
    });

    await this._connect();
    return true;
  }

  async _connect() {
    this.socket = await this.connect({
      onConnectionUpdate: (update, socket) => this._onConnectionUpdate(update, socket),
      onMessages: (event) => this._onMessages(event),
    });
  }

  _onConnectionUpdate({ connection, lastDisconnect }, socket) {
    if (connection === 'open') {
      log.info('Conectado');
      this.user = socket.user;
      this.open = true;
      this.reconnectDelay = 5000;
      const pending = this.outbox.splice(0);
      pending.forEach((text) => this._send(text));
      return;
    }

    if (connection !== 'close') return;
    this.open = false;
    const code = lastDisconnect?.error?.output?.statusCode;
    if (FATAL_DISCONNECT_CODES.has(code)) {
      log.error(`Conexión cerrada (código ${code}). Hay que volver a vincular con npm run whatsapp:link`);
      return;
    }
    log.warn(`Conexión perdida (código ${code}); reintento en ${this.reconnectDelay / 1000} s`);
    const timer = setTimeout(() => {
      this._connect().catch((err) => log.error(`No se pudo reconectar: ${err.message}`));
    }, this.reconnectDelay);
    timer.unref?.();
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
  }

  async _onMessages({ type, messages }) {
    if (type !== 'notify') return;
    for (const message of messages) {
      try {
        await this._handleMessage(message);
      } catch (err) {
        log.error(`Error procesando un mensaje: ${err.message}`);
      }
    }
  }

  async _handleMessage(message) {
    // El resto de tus chats también llega acá: se descarta antes de leer su contenido.
    if (!isOwnChatMessage(message, this.user)) return;
    if (this.seen.has(message.key.id)) return;
    this._remember(message.key.id);

    const content = await this.normalize(message.message);
    const text = extractText(content);
    if (text.startsWith(VIOLET_MARKER)) return;
    this.chatJid = message.key.remoteJid;

    if (!text) {
      // Sin texto también llegan avisos internos de sincronización: esos no se contestan.
      if (isMedia(content)) await this._send('Por ahora solo leo mensajes de texto.');
      return;
    }

    const command = await this._runCommand(text);
    if (command) {
      await this._send(command);
      return;
    }

    try {
      await this.violet.send(text, [], 'whatsapp');
    } catch (err) {
      await this._send(`No pude responder: ${err.message}`);
    }
  }

  _remember(id) {
    this.seen.add(id);
    if (this.seen.size > MAX_SEEN_IDS) this.seen.delete(this.seen.values().next().value);
  }

  // Estas órdenes las resuelve el código: nunca pasan por el modelo.
  async _runCommand(text) {
    if (text.toLowerCase() === '/stop') return this._stopAgents();
    if (!this.violet.hasPendingAction()) return null;

    // Con una acción retenida, tu próximo mensaje es la respuesta. Las respuestas de Violet
    // nunca llegan hasta acá (marca + ID), así que el modelo no puede decir que sí por vos.
    const answer = text.toLowerCase().replace(/[^a-záéíóú]/g, '');
    if (['si', 'sí', 'dale', 'ok', 'autorizo'].includes(answer)) return this.violet.confirmPendingAction();
    const dismissed = this.violet.cancelPendingAction();
    // Si escribiste otra cosa, la acción se descarta (un "sí" posterior no la revive) y el mensaje sigue su curso.
    return ['no', 'cancelar'].includes(answer) ? dismissed : null;
  }

  async _stopAgents() {
    const live = this.agentManager.getAll().filter((agent) => agent.status === 'active');
    const results = await Promise.all(live.map((agent) => this.agentManager.stop(agent.id)));
    const stopped = results.filter(Boolean).length;
    const running = live.length - stopped;
    if (live.length === 0) return 'No hay agentes activos.';
    return running === 0
      ? `Detuve ${stopped} agente(s).`
      : `Detuve ${stopped} agente(s). ${running} supervisado(s) siguen activos: esos solo se detienen desde la PC.`;
  }

  async _send(text) {
    if (!this.open) {
      this.outbox.push(text);
      return;
    }
    const target = this.chatJid ?? ownChatJids(this.user)[0];
    try {
      for (const part of splitMessage(text)) {
        const sent = await this.socket.sendMessage(target, { text: `${VIOLET_MARKER}\n${part}` });
        // Segunda barrera contra el bucle: lo que envió Violet se reconoce por ID, aunque cambie el texto.
        if (sent?.key?.id) this._remember(sent.key.id);
      }
    } catch (err) {
      log.error(`No se pudo enviar un mensaje: ${err.message}`);
    }
  }
}

export const whatsappService = new WhatsAppService();

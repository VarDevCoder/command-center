// Violet — chat personal con cerebro Codex (cuenta ChatGPT Plus del usuario)
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { PATHS } from '../utils/paths.js';

const log = createLogger('Violet');

const HISTORY_FILE = join(PATHS.claudeDir, '..', 'command-center-data', 'violet-history.json');

class VioletService extends EventEmitter {
  constructor() {
    super();
    this.threadId = null;
    this.messages = []; // { role: 'user'|'violet', text, timestamp }
    this.busy = false;
    this._loaded = this._loadHistory();
  }

  async _loadHistory() {
    try {
      const raw = await readFile(HISTORY_FILE, 'utf8');
      const data = JSON.parse(raw);
      this.threadId = data.threadId || null;
      this.messages = data.messages || [];
      log.info(`Historial cargado: ${this.messages.length} mensajes, thread ${this.threadId || 'ninguno'}`);
    } catch {
      // sin historial previo — arranque limpio
    }
  }

  async _saveHistory() {
    try {
      await mkdir(join(PATHS.claudeDir, '..', 'command-center-data'), { recursive: true });
      await writeFile(HISTORY_FILE, JSON.stringify({
        threadId: this.threadId,
        messages: this.messages,
      }, null, 2));
    } catch (err) {
      log.error('Error guardando historial:', err.message);
    }
  }

  async getHistory() {
    await this._loaded;
    return this.messages;
  }

  /**
   * Envía un mensaje a Violet (Codex) y devuelve su respuesta completa.
   */
  async send(text) {
    await this._loaded;
    if (this.busy) {
      throw new Error('Violet ya está respondiendo, esperá un momento');
    }
    this.busy = true;

    const userMsg = { role: 'user', text, timestamp: new Date().toISOString() };
    this.messages.push(userMsg);
    this.emit('message', userMsg);

    try {
      const reply = await this._runCodex(text);
      const violetMsg = { role: 'violet', text: reply, timestamp: new Date().toISOString() };
      this.messages.push(violetMsg);
      this.emit('message', violetMsg);
      await this._saveHistory();
      return violetMsg;
    } finally {
      this.busy = false;
    }
  }

  _runCodex(prompt) {
    return new Promise((resolve, reject) => {
      const baseArgs = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config'];
      const args = this.threadId
        ? ['exec', 'resume', this.threadId, prompt, '--json', '--skip-git-repo-check', '--ignore-user-config']
        : [...baseArgs, prompt];

      log.info(`codex ${args.join(' ')}`.slice(0, 150));

      const child = spawn('codex', args, {
        cwd: PATHS.workspace,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buffer = '';
      let replyText = '';
      let errorMsg = null;

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'thread.started' && evt.thread_id) {
              this.threadId = evt.thread_id;
            }
            if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
              replyText = evt.item.text || replyText;
            }
            if (evt.type === 'error' || evt.type === 'turn.failed') {
              errorMsg = evt.message || evt.error?.message || 'Error desconocido de Codex';
            }
          } catch {
            // línea no-JSON — ignorar
          }
        }
      });

      let stderrText = '';
      child.stderr.on('data', (data) => { stderrText += data.toString(); });

      child.on('close', (code) => {
        if (errorMsg) return reject(new Error(errorMsg));
        if (code !== 0 && !replyText) {
          return reject(new Error(stderrText.trim() || `Codex terminó con código ${code}`));
        }
        resolve(replyText || '(sin respuesta)');
      });

      child.on('error', (err) => reject(err));
    });
  }
}

export const violetService = new VioletService();

// Chat por repo + proveedor — hablale directamente a Claude/Codex/Ollama de un repo
import { spawn } from 'node:child_process';
import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { getProjectSessionsDir, PATHS } from '../utils/paths.js';
import { parseSessionFile, parseSessionLine, getSessionMeta } from './sessionParser.js';
import { listRepos } from './githubService.js';
import * as codexProvider from './providers/codexProvider.js';
import { createLogger } from '../utils/logger.js';

const NOISE_PREFIXES = ['<browser_instruction', '<system-reminder', '<pasted_content', '<ide_selection'];
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const FLAT_CHATS_FILE = join(PATHS.claudeDir, '..', 'command-center-data', 'repo-chats.json');

const log = createLogger('RepoChat');

class RepoChatService extends EventEmitter {
  /**
   * Todos los chats con actividad: uno por cada (repo, proveedor) que ya
   * tiene conversación — Claude desde sus sesiones JSONL reales, Codex/Ollama
   * desde el archivo plano propio.
   */
  async listChats() {
    const repos = await listRepos();
    const local = repos.filter((r) => r.clonedLocally);
    const flat = await this._loadFlat();

    const claudeChats = await Promise.all(
      local.map(async (r) => {
        const lastSession = await this._findLastClaudeSession(r.dir);
        if (!lastSession) return null;

        const meta = await getSessionMeta(lastSession.path);
        const preview = await this._lastRealUserMessage(lastSession.path);
        return {
          repoDir: r.dir,
          repoName: r.name,
          fullName: r.fullName,
          provider: 'claude',
          sessionId: meta.sessionId,
          preview,
          lastActivity: lastSession.mtime,
        };
      })
    );

    const flatChats = Object.entries(flat).map(([key, chat]) => {
      const repo = local.find((r) => r.dir === chat.repoDir);
      const last = chat.messages[chat.messages.length - 1];
      return {
        repoDir: chat.repoDir,
        repoName: repo?.name || chat.repoName,
        fullName: repo?.fullName || chat.repoName,
        provider: chat.provider,
        sessionId: chat.threadId || null,
        preview: last?.text?.slice(0, 120) || '',
        lastActivity: last?.timestamp || chat.startedAt,
      };
    });

    return [...claudeChats.filter(Boolean), ...flatChats]
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  /**
   * Historial de la conversación de un repo con un proveedor dado.
   */
  async getHistory(repoDir, provider = 'claude') {
    if (provider === 'claude') {
      const lastSession = await this._findLastClaudeSession(repoDir);
      if (!lastSession) return { sessionId: null, entries: [] };
      const entries = await parseSessionFile(lastSession.path);
      const meta = await getSessionMeta(lastSession.path);
      return { sessionId: meta.sessionId, entries };
    }

    const flat = await this._loadFlat();
    const chat = flat[this._key(repoDir, provider)];
    if (!chat) return { sessionId: null, entries: [] };

    const entries = chat.messages.map((m) => ({
      type: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    return { sessionId: chat.threadId || null, entries };
  }

  /**
   * Envía un mensaje al proveedor elegido para este repo.
   */
  async sendMessage(repoDir, repoName, text, provider = 'claude') {
    if (provider === 'claude') return this._sendClaude(repoDir, repoName, text);
    if (provider === 'codex') return this._sendCodex(repoDir, repoName, text);
    if (provider === 'ollama') return this._sendOllama(repoDir, repoName, text);
    throw new Error(`Proveedor desconocido: ${provider}`);
  }

  // --- Claude: retoma la última sesión real encontrada en disco ---

  async _sendClaude(repoDir, repoName, text) {
    const lastSession = await this._findLastClaudeSession(repoDir);
    const sessionId = lastSession ? (await getSessionMeta(lastSession.path)).sessionId : null;

    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    if (sessionId) args.unshift('--resume', sessionId);

    log.info(`claude ${args.join(' ')} en ${repoDir}`);

    const env = { ...process.env };
    delete env.CLAUDE_CODE;
    delete env.CLAUDECODE;

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd: repoDir,
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.write(text);
      child.stdin.end();

      let buffer = '';
      let replyText = '';
      let newSessionId = sessionId;
      let stderrText = '';

      child.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.session_id) newSessionId = evt.session_id;
            if (evt.type === 'result' && evt.result) replyText = evt.result;
            if (evt.type === 'assistant' && evt.message?.content) {
              const textBlock = evt.message.content.find((b) => b.type === 'text');
              if (textBlock) replyText = textBlock.text;
            }
          } catch {
            // línea no-JSON — ignorar
          }
        }
      });

      child.stderr.on('data', (data) => { stderrText += data.toString(); });

      child.on('close', (code) => {
        if (code !== 0 && !replyText) {
          return reject(new Error(stderrText.trim() || `Claude Code terminó con código ${code}`));
        }
        const result = {
          repoDir, repoName, provider: 'claude',
          text: replyText || '(sin respuesta)',
          sessionId: newSessionId,
          timestamp: new Date().toISOString(),
        };
        this.emit('message', result);
        resolve(result);
      });

      child.on('error', (err) => reject(err));
    });
  }

  // --- Codex: persistencia propia en archivo plano, resume por threadId ---

  async _sendCodex(repoDir, repoName, text) {
    const key = this._key(repoDir, 'codex');
    const flat = await this._loadFlat();
    const chat = flat[key] || { repoDir, repoName, provider: 'codex', threadId: null, messages: [], startedAt: new Date().toISOString() };

    chat.messages.push({ role: 'user', text, timestamp: new Date().toISOString() });

    const { replyText, threadId } = await codexProvider.run({
      prompt: text,
      projectDir: repoDir,
      resumeFrom: chat.threadId,
    });

    chat.threadId = threadId;
    chat.messages.push({ role: 'assistant', text: replyText, timestamp: new Date().toISOString() });
    flat[key] = chat;
    await this._saveFlat(flat);

    const result = { repoDir, repoName, provider: 'codex', text: replyText, sessionId: threadId, timestamp: new Date().toISOString() };
    this.emit('message', result);
    return result;
  }

  // --- Ollama: persistencia propia, historial completo reenviado en cada turno ---

  async _sendOllama(repoDir, repoName, text, model = 'qwen2.5-coder:7b') {
    const key = this._key(repoDir, 'ollama');
    const flat = await this._loadFlat();
    const chat = flat[key] || { repoDir, repoName, provider: 'ollama', model, messages: [], startedAt: new Date().toISOString() };

    chat.messages.push({ role: 'user', text, timestamp: new Date().toISOString() });

    const history = chat.messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n');
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: chat.model, prompt: history, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const replyText = data.response || '(sin respuesta)';

    chat.messages.push({ role: 'assistant', text: replyText, timestamp: new Date().toISOString() });
    flat[key] = chat;
    await this._saveFlat(flat);

    const result = { repoDir, repoName, provider: 'ollama', text: replyText, sessionId: null, timestamp: new Date().toISOString() };
    this.emit('message', result);
    return result;
  }

  // --- Persistencia plana (Codex/Ollama) ---

  _key(repoDir, provider) {
    return `${provider}::${repoDir}`;
  }

  async _loadFlat() {
    try {
      const raw = await readFile(FLAT_CHATS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _saveFlat(all) {
    await mkdir(dirname(FLAT_CHATS_FILE), { recursive: true });
    await writeFile(FLAT_CHATS_FILE, JSON.stringify(all, null, 2));
  }

  // --- Helpers de sesiones Claude reales en disco ---

  async _lastRealUserMessage(filePath) {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream });

    let lastMessage = '';
    for await (const line of rl) {
      if (!line.trim()) continue;
      const parsed = parseSessionLine(line);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.type !== 'user' || !item.content) continue;
        const trimmed = item.content.trim();
        if (!trimmed) continue;
        if (NOISE_PREFIXES.some((p) => trimmed.startsWith(p))) continue;
        lastMessage = trimmed.slice(0, 120);
      }
    }
    return lastMessage;
  }

  async _findLastClaudeSession(repoDir) {
    const sessionsDir = getProjectSessionsDir(repoDir);
    let entries;
    try {
      entries = await readdir(sessionsDir, { withFileTypes: true });
    } catch {
      return null;
    }

    const jsonlFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) return null;

    const withStats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const path = join(sessionsDir, f.name);
        const s = await stat(path);
        return { path, mtime: s.mtime };
      })
    );

    withStats.sort((a, b) => b.mtime - a.mtime);
    return withStats[0];
  }
}

export const repoChatService = new RepoChatService();

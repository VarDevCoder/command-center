import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);
const SESSION_ROOT = process.env.VSCODE_AGENT_SESSION_DIR
  || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Code', 'agentSessionData');
const CODE_COMMAND = process.env.VSCODE_COMMAND || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe')
  : 'code');

function parseValue(value) {
  if (!value) return value;
  try { return JSON.parse(value); } catch { return value; }
}

function fileUriToPath(uri) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('file:')) return uri || '';
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname).replace(/^\/(\w:)/, '$1').replace(/\//g, '\\');
  } catch { return uri; }
}

function runCode(args, options = {}) {
  return execFileAsync(CODE_COMMAND, args, { windowsHide: true, timeout: 15000, maxBuffer: 5_000_000, ...options });
}

class VsCodeAgentService {
  async listSessions() {
    const active = await this._activeSessions();
    let dirs = [];
    try { dirs = await readdir(SESSION_ROOT, { withFileTypes: true }); } catch { return active; }

    const stored = [];
    for (const entry of dirs) {
      if (!entry.isDirectory() || entry.name.startsWith('default-')) continue;
      const dbPath = join(SESSION_ROOT, entry.name, 'session.db');
      try {
        const info = await stat(dbPath);
        const db = new DatabaseSync(dbPath, { readOnly: true });
        const metadata = Object.fromEntries(
          db.prepare('SELECT key, value FROM session_metadata').all().map((row) => [row.key, parseValue(row.value)])
        );
        const usageRows = db.prepare('SELECT usage FROM turn_usage').all();
        db.close();

        const usage = usageRows.reduce((sum, row) => {
          const value = parseValue(row.usage) || {};
          sum.inputTokens += value.inputTokens || 0;
          sum.cachedTokens += value.cacheReadTokens || 0;
          sum.outputTokens += value.outputTokens || 0;
          return sum;
        }, { inputTokens: 0, cachedTokens: 0, outputTokens: 0 });

        const sessionId = metadata.defaultChatProviderData?.sessionId || entry.name;
        const live = active.find((item) => item.sessionId === sessionId || item.id === sessionId);
        stored.push({
          id: sessionId,
          uri: live?.uri || `codex:/${sessionId}`,
          title: metadata.customTitle || 'Sesión sin título',
          provider: metadata['codex.threadId'] ? 'codex' : 'vscode',
          model: metadata['codex.model'] || metadata.defaultChatProviderData?.model?.id || '',
          workspace: fileUriToPath(metadata['codex.cwd']),
          branch: metadata['agentHost.git']?.branchName || '',
          changes: metadata['agentHost.changes'] || { additions: 0, deletions: 0, files: 0 },
          status: live?.status || (metadata.isArchived ? 'archived' : 'idle'),
          active: Boolean(live),
          updatedAt: info.mtime.toISOString(),
          usage,
        });
      } catch {
        // Una sesión puede estar siendo creada o migrada por VS Code.
      }
    }
    return stored.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  async stop(uri) {
    if (!/^[a-z][a-z0-9+.-]*:\/[a-zA-Z0-9/_-]+$/.test(uri || '')) throw new Error('URI de sesión inválida');
    await runCode(['agent', 'stop', uri]);
    return { uri, stopped: true };
  }

  async openProject(projectDir) {
    if (!projectDir) throw new Error('Falta el directorio del proyecto');
    const info = await stat(projectDir);
    if (!info.isDirectory()) throw new Error('El proyecto no es un directorio');
    const child = spawn(CODE_COMMAND, ['--agents', projectDir], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { projectDir, opened: true };
  }

  async _activeSessions() {
    try {
      const { stdout } = await runCode(['agent', 'ps', '--all', '--json']);
      const parsed = JSON.parse(stdout);
      const rows = Array.isArray(parsed) ? parsed : parsed.sessions || [];
      return rows.map((row) => ({
        ...row,
        id: row.id || row.sessionId || row.session_id,
        sessionId: row.sessionId || row.session_id || row.id,
        uri: row.uri || row.sessionUri || row.session_uri,
        status: row.status || 'active',
      }));
    } catch { return []; }
  }
}

export const vscodeAgentService = new VsCodeAgentService();


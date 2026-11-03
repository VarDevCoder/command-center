import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const CLAUDE_EXE = process.env.CLAUDE_CLI_PATH || (process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  : 'claude');

class ProviderAccountService {
  async list() {
    return [await this.claudeStatus()];
  }

  async claudeStatus() {
    try {
      const [{ stdout: statusOutput }, { stdout: versionOutput }] = await Promise.all([
        execFileAsync(CLAUDE_EXE, ['auth', 'status', '--json'], { windowsHide: true, timeout: 10000 }),
        execFileAsync(CLAUDE_EXE, ['--version'], { windowsHide: true, timeout: 10000 }),
      ]);
      const status = JSON.parse(statusOutput);
      return {
        id: 'claude',
        name: 'Claude Code',
        connected: Boolean(status.loggedIn),
        email: status.email || null,
        organization: status.orgName || null,
        subscription: status.subscriptionType || null,
        authMethod: status.authMethod || null,
        apiProvider: status.apiProvider || null,
        version: versionOutput.trim().replace(/\s*\(Claude Code\)\s*$/, ''),
      };
    } catch (err) {
      return {
        id: 'claude',
        name: 'Claude Code',
        connected: false,
        available: err.code !== 'ENOENT',
        error: err.code === 'ENOENT' ? 'Claude Code no está instalado' : err.message,
      };
    }
  }

  async loginClaude(email) {
    const current = await this.claudeStatus();
    if (current.connected) return { ...current, loginStarted: false };
    if (current.available === false) throw new Error('Claude Code no está instalado');

    const args = ['auth', 'login', '--claudeai'];
    if (email) args.push('--email', email);
    const child = spawn(CLAUDE_EXE, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { id: 'claude', connected: false, loginStarted: true };
  }
}

export const providerAccountService = new ProviderAccountService();


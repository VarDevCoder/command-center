// Agente Ollama — loop de tool-calling en texto plano, pensado para correr
// dentro de un worktree ya creado por el pipeline supervisado compartido
// (ver gitSupervision.js y supervisedAgentService.js). Esta clase ya no
// crea/limpia worktrees ni corre la revisión — solo sabe "trabajar".
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { PATHS } from '../utils/paths.js';

const log = createLogger('OllamaAgent');
const execFileAsync = promisify(execFile);

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const TASKS_FILE = join(PATHS.claudeDir, '..', 'command-center-data', 'ollama-tasks.json');
const MAX_TURNS = 5;

// Comandos destructivos/irreversibles — bloqueados antes de ejecutar.
// Defensa best-effort por regex; el verdadero backstop es el worktree aislado.
const DENY_PATTERNS = [
  /\bgit\s+push\b/i,
  /--force\b/i,
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdel\s+\/[sf]/i,
  /\.\.[\\/]/,
];

const SYSTEM_PROMPT = (worktreePath) => `You are an autonomous coding agent working inside a git worktree at ${worktreePath}.
Respond with ONLY one fenced \`\`\`json code block containing a single tool call, nothing else:
{"tool": "read_file", "path": "relative/path.js"}
{"tool": "write_file", "path": "relative/path.js", "content": "..."}
{"tool": "list_dir", "path": "relative/path"}
{"tool": "run_command", "command": "npm test"}
{"tool": "done", "summary": "what you changed and why"}
All paths are relative to the worktree root. You cannot access anything outside it.
Before calling "done", you MUST commit your changes with run_command: git add -A && git commit -m "..." using a descriptive message. Do not push or touch any other branch.
When the task is complete (and committed), respond with the "done" tool.`;

class OllamaAgentService extends EventEmitter {
  constructor() {
    super();
    this.histories = new Map(); // taskId -> array de líneas de historial del turn-loop
  }

  async listTasks() {
    const all = await this._loadAll();
    return Object.values(all).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  async getTask(taskId) {
    const all = await this._loadAll();
    return all[taskId] || null;
  }

  async _loadAll() {
    try {
      const raw = await readFile(TASKS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _saveTask(task) {
    const all = await this._loadAll();
    all[task.taskId] = task;
    await mkdir(dirname(TASKS_FILE), { recursive: true });
    await writeFile(TASKS_FILE, JSON.stringify(all, null, 2));
  }

  /**
   * Corre el loop de tool-calling de Ollama dentro de un worktree ya
   * creado. Usado tanto para el intento inicial como para un reintento
   * (cuando resume=true, agrega reviewNotes al historial existente en vez
   * de arrancar de cero). Devuelve { doneSummary } — doneSummary es null
   * si se agotaron los turnos sin que el modelo llamara "done".
   */
  async runTurnLoop({ taskId, worktreePath, prompt, model, maxTurns = MAX_TURNS, resume = false, reviewNotes }) {
    let task = (await this._loadAll())[taskId];
    if (!task) {
      task = {
        taskId, worktreePath, model, turns: [],
        startedAt: new Date().toISOString(),
      };
    }

    let history = this.histories.get(taskId);
    if (!resume || !history) {
      history = [`${SYSTEM_PROMPT(worktreePath)}\n\nTask: ${prompt}`];
    } else {
      history.push(`System: El revisor encontró problemas. Corregilos:\n${reviewNotes}`);
    }
    this.histories.set(taskId, history);

    let turn = 0;
    let doneSummary = null;

    while (turn < maxTurns) {
      turn++;
      const modelResponse = await this._callOllama(model, history.join('\n\n'));
      const toolCall = this._parseToolCall(modelResponse);

      if (!toolCall) {
        const errMsg = 'Your last response could not be parsed as JSON. Reply with only the JSON tool-call block.';
        history.push(`Assistant: ${modelResponse}`);
        history.push(`System: ${errMsg}`);
        const parseErrorCall = { tool: 'parse_error' };
        this._recordTurn(task, turn, parseErrorCall, errMsg);
        this.emit('turn', { taskId, turn, toolCall: parseErrorCall, timestamp: new Date().toISOString() });
        this.emit('toolResult', { taskId, turn, tool: 'parse_error', result: errMsg, timestamp: new Date().toISOString() });
        await this._saveTask(task);
        continue;
      }

      this.emit('turn', { taskId, turn, toolCall, timestamp: new Date().toISOString() });

      if (toolCall.tool === 'done') {
        doneSummary = toolCall.summary || '(sin resumen)';
        this._recordTurn(task, turn, toolCall, doneSummary);
        await this._saveTask(task);
        break;
      }

      const result = await this._executeTool(worktreePath, toolCall);
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      history.push(`Assistant: ${JSON.stringify(toolCall)}`);
      history.push(`Tool result: ${resultStr.slice(0, 2000)}`);
      this._recordTurn(task, turn, toolCall, resultStr);

      this.emit('toolResult', {
        taskId, turn, tool: toolCall.tool, result: resultStr.slice(0, 500),
        timestamp: new Date().toISOString(),
      });

      await this._saveTask(task);
    }

    return { doneSummary };
  }

  _recordTurn(task, turn, toolCall, result) {
    task.turns = task.turns || [];
    task.turns.push({ turn, toolCall, result: String(result).slice(0, 2000), timestamp: new Date().toISOString() });
  }

  async _callOllama(model, prompt) {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) {
      throw new Error(`Ollama respondió ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data.response || '';
  }

  _parseToolCall(text) {
    const fencedJson = text.match(/```json\s*([\s\S]*?)```/);
    const fenced = text.match(/```\s*([\s\S]*?)```/);
    const candidates = [fencedJson?.[1], fenced?.[1], text];

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate.trim());
        if (parsed && typeof parsed.tool === 'string') return parsed;
      } catch {
        // seguir probando el siguiente candidato
      }
    }
    return null;
  }

  async _executeTool(worktreePath, toolCall) {
    switch (toolCall.tool) {
      case 'read_file':
        return this._readFile(worktreePath, toolCall.path);
      case 'write_file':
        return this._writeFile(worktreePath, toolCall.path, toolCall.content ?? '');
      case 'list_dir':
        return this._listDir(worktreePath, toolCall.path || '.');
      case 'run_command':
        return this._runCommand(worktreePath, toolCall.command);
      default:
        return `Error: herramienta desconocida "${toolCall.tool}"`;
    }
  }

  _resolveInWorktree(worktreePath, relPath) {
    const target = resolve(worktreePath, relPath || '.');
    const rel = relative(worktreePath, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path fuera del worktree: ${relPath}`);
    }
    return target;
  }

  async _readFile(worktreePath, path) {
    try {
      const target = this._resolveInWorktree(worktreePath, path);
      return await readFile(target, 'utf8');
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  async _writeFile(worktreePath, path, content) {
    try {
      const target = this._resolveInWorktree(worktreePath, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      return `OK: escrito ${path}`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  async _listDir(worktreePath, path) {
    try {
      const target = this._resolveInWorktree(worktreePath, path);
      const entries = await readdir(target, { withFileTypes: true });
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  async _runCommand(worktreePath, command) {
    if (!command || typeof command !== 'string') return 'Error: comando vacío';
    if (DENY_PATTERNS.some((p) => p.test(command))) {
      return `Error: comando bloqueado por política de seguridad: "${command}"`;
    }
    try {
      const { stdout, stderr } = await execFileAsync(command, {
        cwd: worktreePath,
        shell: true,
        timeout: 60_000,
        windowsHide: true,
      });
      return (stdout + stderr).trim() || '(sin output)';
    } catch (err) {
      return `Error ejecutando comando: ${err.message}`;
    }
  }
}

export const ollamaAgentService = new OllamaAgentService();

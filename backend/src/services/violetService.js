// Violet — chat personal con cerebro Codex (cuenta ChatGPT Plus del usuario)
// Tiene dos herramientas reales: leer repos clonados (solo lectura) y lanzar
// agentes Claude Code/Codex en Mission Control.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { PATHS } from '../utils/paths.js';
import { listRepos } from './githubService.js';
import { vscodeAgentService } from './vscodeAgentService.js';
import { usageMetricsService } from './usageMetricsService.js';

const log = createLogger('Violet');

const HISTORY_FILE = join(PATHS.claudeDir, '..', 'command-center-data', 'violet-history.json');
const ATTACHMENTS_DIR = process.env.COMMAND_CENTER_DATA_DIR
  ? join(process.env.COMMAND_CENTER_DATA_DIR, 'violet-attachments')
  : join(process.cwd(), 'data', 'violet-attachments');
const MAX_TOOL_TURNS = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/png': { extension: 'png', signature: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: 'jpg', signature: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { extension: 'webp', signature: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { extension: 'gif', signature: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()) },
};
const CODEX_JS = process.env.CODEX_CLI_JS || join(
  process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js',
);

// Vault de Obsidian del Jefe — ruta fija, no es un repo de GitHub así que no
// pasa por repoLocator/githubService como los demás repos.
const OBSIDIAN_VAULT = 'C:\\Dev\\MemoriasMias\\Desarrollo';

const SYSTEM_PROMPT = `Sos Violet, la coordinadora personal del Jefe dentro de Command Center. Tenés acceso a herramientas reales:

1. read_repo: leé un archivo o listá un directorio de cualquier repo que el Jefe ya tenga clonado localmente. Uso: {"tool": "read_repo", "repo": "nombre o parte del nombre del repo", "path": "ruta relativa dentro del repo, o '.' para listar la raíz"}
2. read_vault: leé un archivo o listá una carpeta del vault de Obsidian del Jefe (sus notas personales). Uso: {"tool": "read_vault", "path": "ruta relativa dentro del vault, o '.' para listar la raíz"}
3. launch_agent: lanzá un agente real de Claude Code o Codex para que trabaje en un repo o directamente en el vault de Obsidian. Uso: {"tool": "launch_agent", "repo": "nombre del repo, o la palabra 'obsidian' para trabajar en el vault", "provider": "claude" o "codex", "model": "ej. sonnet", "prompt": "instrucciones claras y completas para el agente"}
4. list_vscode_sessions: listá las sesiones reales de la ventana Agents de VS Code. Uso: {"tool":"list_vscode_sessions"}
5. open_vscode_project: abrí un proyecto en la ventana Agents de VS Code. Uso: {"tool":"open_vscode_project","repo":"nombre del repo"}
6. stop_vscode_turn: cancelá el turno activo de una sesión de VS Code. Uso: {"tool":"stop_vscode_turn","uri":"codex:/id-de-sesion"}
7. usage_metrics: consultá tokens y costo API equivalente estimado de Claude Code y ChatGPT/Codex. Uso: {"tool":"usage_metrics","days":30}

Cuando necesites usar una herramienta, respondé con ÚNICAMENTE un bloque \`\`\`json con una sola de esas llamadas, nada más de texto. El sistema te va a devolver el resultado y vos seguís la conversación.
Cuando ya tengas lo que necesitás (o no haga falta ninguna herramienta), respondé normalmente en texto, como siempre lo hacés, con tu personalidad.
No podés editar archivos vos misma — ni en repos ni en el vault. Solo leer y lanzar agentes, que son quienes hacen el trabajo real de escritura (por ejemplo, crear una nota nueva en el vault con un resumen).`;

class VioletService extends EventEmitter {
  constructor() {
    super();
    this.threadId = null;
    this.messages = []; // { role: 'user'|'violet', text, timestamp }
    this.busy = false;
    this._loaded = this._loadHistory();
    this.agentManager = null;
    this.watchedAgents = new Map(); // agentId -> { label, provider }
  }

  setAgentManager(manager) {
    this.agentManager = manager;
    manager.on('statusChange', (agent) => this._onAgentStatusChange(agent));
  }

  /**
   * Reporte proactivo: cuando un agente que Violet lanzó termina (completed
   * o error), ella misma agrega un mensaje nuevo al chat contando el
   * resultado, sin que el Jefe tenga que preguntar.
   */
  async _onAgentStatusChange(agent) {
    const watched = this.watchedAgents.get(agent.id);
    if (!watched) return;
    if (agent.status !== 'completed' && agent.status !== 'error') return;

    this.watchedAgents.delete(agent.id);
    await this._loaded;

    const lastLog = [...(agent.logs || [])].reverse().find((l) => l.type === 'output' || l.type === 'assistant' || l.type === 'error');
    const summary = lastLog?.content?.slice(0, 500) || '(sin salida)';
    const verb = agent.status === 'completed' ? 'terminó' : 'falló';

    const text = `Jefe, el agente que lancé en ${watched.label} ${verb}.\n\n${summary}`;
    const violetMsg = { role: 'violet', text, timestamp: new Date().toISOString() };
    this.messages.push(violetMsg);
    this.emit('message', violetMsg);
    await this._saveHistory();
  }

  /**
   * Reporte proactivo del pipeline supervisado (worktree + revisor + PR):
   * Violet avisa sola cuando una tarea necesita atención del Jefe (rechazo,
   * reintentos agotados, PR listo para aprobar, o error publicando).
   */
  async onSupervisedStatusChange(task) {
    const REPORTABLE = ['escalated-rejected', 'escalated-unresolved', 'pr-open', 'publish-error'];
    if (!REPORTABLE.includes(task.status)) return;

    await this._loaded;

    const messages = {
      'escalated-rejected': `Jefe, el agente ${task.provider} que trabajó en ${task.repoFullName || task.projectDir} tuvo un problema grave según el revisor y no voy a reintentar automáticamente.\n\n${task.reviewCycles?.[task.reviewCycles.length - 1]?.notes || ''}`,
      'escalated-unresolved': `Jefe, el agente ${task.provider} en ${task.repoFullName || task.projectDir} no logró resolver las observaciones del revisor tras los reintentos automáticos. La rama "${task.branch}" quedó intacta para que la retomes.\n\n${task.reviewCycles?.[task.reviewCycles.length - 1]?.notes || ''}`,
      'pr-open': `Jefe, hay un PR listo para tu aprobación: ${task.pr?.url || '(sin link)'}\n\nLo armó el agente ${task.provider} en ${task.repoFullName || task.projectDir}. Lo revisás y lo mergeás vos cuando quieras.`,
      'publish-error': `Jefe, no pude publicar el PR del agente ${task.provider} en ${task.repoFullName || task.projectDir}. El trabajo está a salvo en la rama "${task.branch}" — podés reintentar la publicación desde la UI.\n\n${task.lastError || ''}`,
    };

    const violetMsg = { role: 'violet', text: messages[task.status], timestamp: new Date().toISOString() };
    this.messages.push(violetMsg);
    this.emit('message', violetMsg);
    await this._saveHistory();
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

  getAttachment(fileName) {
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(fileName)) {
      const error = new Error('Adjunto inválido');
      error.code = 'INVALID_ATTACHMENT';
      throw error;
    }
    const extension = fileName.split('.').pop();
    const mimeType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[extension];
    return { path: join(ATTACHMENTS_DIR, fileName), mimeType };
  }

  async _storeImages(images) {
    if (!images.length) return [];
    await mkdir(ATTACHMENTS_DIR, { recursive: true });

    return Promise.all(images.map(async ({ name, mimeType, data }) => {
      const type = IMAGE_TYPES[mimeType];
      const bytes = Buffer.from(data, 'base64');
      if (!type || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !type.signature(bytes)) {
        throw new Error(`La imagen "${name}" no es válida o supera 8 MB`);
      }
      const fileName = `${randomUUID()}.${type.extension}`;
      const path = join(ATTACHMENTS_DIR, fileName);
      await writeFile(path, bytes);
      return {
        path,
        public: {
          id: fileName,
          name,
          mimeType,
          url: `/api/v1/violet/attachments/${fileName}`,
        },
      };
    }));
  }

  /**
   * Envía un mensaje a Violet (Codex). Si Violet pide usar una herramienta,
   * el backend la ejecuta y le devuelve el resultado, iterando hasta que
   * responda en texto normal o se alcance el límite de turnos.
   */
  async send(text, images = []) {
    await this._loaded;
    if (this.busy) {
      throw new Error('Violet ya está respondiendo, esperá un momento');
    }
    this.busy = true;

    try {
      const storedImages = await this._storeImages(images);
      const userText = text || 'Analizá estas imágenes.';
      const userMsg = {
        role: 'user',
        text,
        attachments: storedImages.map((image) => image.public),
        timestamp: new Date().toISOString(),
      };
      this.messages.push(userMsg);
      this.emit('message', userMsg);

      // Reinyectamos el system prompt en cada mensaje de usuario (no solo el
      // primero del thread): Codex no garantiza recordar instrucciones de
      // herramientas entre turnos resumidos de la misma forma que un modelo
      // con ventana de contexto completa.
      let prompt = `${SYSTEM_PROMPT}\n\n${userText}`;
      let finalReply = '';

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const turnImages = turn === 0 ? storedImages.map((image) => image.path) : [];
        let reply;
        try {
          reply = await this._runCodex(prompt, turnImages);
        } catch (err) {
          // Un historial viejo puede apuntar a un thread que Codex ya purgó.
          // Abrimos uno nuevo conservando el mensaje y los adjuntos actuales.
          if (!this.threadId || !err.message.includes('no rollout found')) throw err;
          log.warn(`Thread ${this.threadId} ya no existe; iniciando uno nuevo`);
          this.threadId = null;
          reply = await this._runCodex(prompt, turnImages);
        }
        const toolCall = this._parseToolCall(reply);

        if (!toolCall) {
          finalReply = reply;
          break;
        }

        this.emit('toolCall', { tool: toolCall.tool, args: toolCall, timestamp: new Date().toISOString() });
        const result = await this._executeTool(toolCall);
        prompt = `Tool result: ${result}`;

        if (turn === MAX_TOOL_TURNS - 1) {
          finalReply = 'Necesité varios pasos y no llegué a una respuesta final — contame si querés que siga.';
        }
      }

      const violetMsg = { role: 'violet', text: finalReply, timestamp: new Date().toISOString() };
      this.messages.push(violetMsg);
      this.emit('message', violetMsg);
      await this._saveHistory();
      return violetMsg;
    } finally {
      this.busy = false;
    }
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

  async _executeTool(toolCall) {
    try {
      if (toolCall.tool === 'read_repo') return await this._readRepo(toolCall.repo, toolCall.path || '.');
      if (toolCall.tool === 'read_vault') return await this._readVault(toolCall.path || '.');
      if (toolCall.tool === 'launch_agent') return await this._launchAgent(toolCall);
      if (toolCall.tool === 'list_vscode_sessions') return JSON.stringify(await vscodeAgentService.listSessions(), null, 2).slice(0, 12000);
      if (toolCall.tool === 'open_vscode_project') return await this._openVsCodeProject(toolCall.repo);
      if (toolCall.tool === 'stop_vscode_turn') return JSON.stringify(await vscodeAgentService.stop(toolCall.uri));
      if (toolCall.tool === 'usage_metrics') return JSON.stringify(await usageMetricsService.getSummary(toolCall.days), null, 2).slice(0, 12000);
      return `Error: herramienta desconocida "${toolCall.tool}"`;
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  async _resolveRepo(nameQuery) {
    const repos = await listRepos();
    const local = repos.filter((r) => r.clonedLocally);
    const needle = (nameQuery || '').toLowerCase();

    const match = local.find((r) => r.name.toLowerCase() === needle)
      || local.find((r) => r.name.toLowerCase().includes(needle))
      || local.find((r) => needle.includes(r.name.toLowerCase()));

    if (!match) throw new Error(`No encontré ningún repo clonado que coincida con "${nameQuery}"`);
    return match;
  }

  async _readRepo(repoQuery, relPath) {
    const repo = await this._resolveRepo(repoQuery);
    const target = resolve(repo.dir, relPath || '.');
    const rel = relative(repo.dir, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return `Error: ruta fuera del repo "${repo.name}"`;
    }

    try {
      const entries = await readdir(target, { withFileTypes: true });
      const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
      return `Directorio ${repo.name}/${relPath}:\n${listing}`;
    } catch {
      // no es un directorio — intentar leer como archivo
      const content = await readFile(target, 'utf8');
      return `Archivo ${repo.name}/${relPath}:\n${content.slice(0, 4000)}`;
    }
  }

  _resolveReadableDir(relPath) {
    const target = resolve(OBSIDIAN_VAULT, relPath || '.');
    const rel = relative(OBSIDIAN_VAULT, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Ruta fuera del vault de Obsidian');
    }
    return target;
  }

  async _readVault(relPath) {
    const target = this._resolveReadableDir(relPath);

    try {
      const entries = await readdir(target, { withFileTypes: true });
      const listing = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
      return `Vault de Obsidian — directorio ${relPath}:\n${listing}`;
    } catch {
      const content = await readFile(target, 'utf8');
      return `Vault de Obsidian — archivo ${relPath}:\n${content.slice(0, 4000)}`;
    }
  }

  async _launchAgent({ repo: repoQuery, provider = 'claude', model = 'sonnet', prompt }) {
    if (!this.agentManager) return 'Error: el gestor de agentes no está disponible todavía';
    if (!prompt) return 'Error: falta el prompt para el agente';

    const isObsidian = (repoQuery || '').toLowerCase().trim() === 'obsidian';
    const projectDir = isObsidian ? OBSIDIAN_VAULT : (await this._resolveRepo(repoQuery)).dir;
    const label = isObsidian ? 'vault de Obsidian' : repoQuery;

    const agent = this.agentManager.spawn({ prompt, projectDir, provider, model });
    this.watchedAgents.set(agent.id, { label, provider });
    return `Agente lanzado: id ${agent.id}, proveedor ${provider}, destino ${label}. El Jefe puede seguirlo en Mission Control. Te voy a avisar cuando termine.`;
  }

  async _openVsCodeProject(repoQuery) {
    const repo = await this._resolveRepo(repoQuery);
    await vscodeAgentService.openProject(repo.dir);
    return `Abrí ${repo.name} en la ventana Agents de VS Code.`;
  }

  _runCodex(prompt, imagePaths = []) {
    return new Promise((resolve, reject) => {
      // El prompt va por stdin (con '-' como marcador), no como argumento:
      // evita por completo el problema de citar/escapar saltos de línea o
      // comillas en cmd.exe cuando el prompt es largo o multilínea.
      const imageArgs = imagePaths.flatMap((path) => ['-i', path]);
      const baseArgs = ['exec', ...imageArgs, '-', '--json', '--skip-git-repo-check', '--ignore-user-config'];
      const args = this.threadId
        ? ['exec', 'resume', this.threadId, ...imageArgs, '-', '--json', '--skip-git-repo-check', '--ignore-user-config']
        : baseArgs;

      log.info(`codex ${args.join(' ')}`.slice(0, 150));

      const child = spawn(process.execPath, [CODEX_JS, ...args], {
        cwd: PATHS.workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.write(prompt);
      child.stdin.end();

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

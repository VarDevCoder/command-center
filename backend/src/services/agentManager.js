// Router de agentes multi-proveedor (Claude Code, Codex, Ollama)
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { spawnClaude } from './providers/claudeProvider.js';
import * as codexProvider from './providers/codexProvider.js';
import { looksLikeModification } from './gitSupervision.js';
import { supervisedAgentService } from './supervisedAgentService.js';

const log = createLogger('AgentMgr');

const CODEX_DEFAULT_MODEL = 'gpt-6.1-sol';

const SUPERVISED_AGENT_STATUS = {
  working: 'active',
  reviewing: 'active',
  retrying: 'active',
  'no-changes': 'completed',
  'approved-unpublished': 'completed',
  'pr-open': 'completed',
  merged: 'completed',
  'escalated-rejected': 'stopped',
  'escalated-unresolved': 'stopped',
  'publish-error': 'stopped',
  error: 'stopped',
};

// Intentar importar tree-kill, fallback a process.kill
let treeKill;
try {
  const mod = await import('tree-kill');
  treeKill = mod.default || mod;
} catch {
  treeKill = (pid, signal, cb) => {
    try {
      process.kill(pid, signal);
    } catch { /* proceso ya muerto */ }
    if (cb) cb();
  };
}

export class AgentManager extends EventEmitter {
  constructor() {
    super();
    // Mapa de agentes: id -> agentInfo
    this.agents = new Map();
    this.counter = 0;
    supervisedAgentService.on('statusChange', (task) => this._syncSupervised(task));
  }

  _syncSupervised(task) {
    const agent = this.agents.get(task.taskId);
    const status = SUPERVISED_AGENT_STATUS[task.status];
    if (!agent || !status || agent.status === status) return;

    agent.status = status;
    agent.endedAt = status === 'active' ? null : new Date().toISOString();
    this.emit('statusChange', this.serialize(agent));
  }

  /**
   * Spawna un nuevo agente, delegando al provider correspondiente. Si la
   * tarea va a modificar código (Ollama siempre, o Claude/Codex cuando el
   * prompt matchea la heurística de palabras de modificación), se rutea al
   * pipeline supervisado (worktree + revisor + PR) en vez del modo directo.
   */
  spawn({ prompt, projectDir, provider = 'claude', model = 'sonnet', effort, allowedTools, resumeFrom, repoFullName }) {
    // Violet y la API usan 'sonnet' por defecto, y Codex rechaza los modelos de Claude.
    if (provider === 'codex' && /^(sonnet|opus|haiku)\b/i.test(model)) model = CODEX_DEFAULT_MODEL;

    const id = `agent-${++this.counter}-${Date.now()}`;

    const agentInfo = {
      id,
      pid: null,
      status: 'spawning',
      prompt: prompt.slice(0, 200),
      projectDir,
      provider,
      model,
      effort: effort || null,
      startedAt: new Date().toISOString(),
      logs: [],
      sessionId: null,
      tokensIn: 0,
      tokensOut: 0,
    };

    this.agents.set(id, agentInfo);

    const protectedMode = provider === 'ollama' || looksLikeModification(prompt);

    if (protectedMode) {
      agentInfo.status = 'active';
      agentInfo.supervised = true;
      this.emit('spawned', this.serialize(agentInfo));
      supervisedAgentService.runProtected({ taskId: id, projectDir, prompt, provider, model, effort, repoFullName });
      return this.serialize(agentInfo);
    }

    if (provider === 'codex') {
      agentInfo.status = 'active';
      this.emit('spawned', this.serialize(agentInfo));

      codexProvider.run({ prompt, projectDir, model, effort, resumeFrom })
        .then(({ replyText, threadId }) => {
          const a = this.agents.get(id);
          if (!a) return;
          a.sessionId = threadId;
          this.addLog(id, {
            type: 'assistant',
            content: replyText,
            timestamp: new Date().toISOString(),
          });
          a.status = 'completed';
          a.endedAt = new Date().toISOString();
          this.emit('statusChange', this.serialize(a));
        })
        .catch((err) => {
          const a = this.agents.get(id);
          if (!a) return;
          this.addLog(id, { type: 'error', content: err.message, timestamp: new Date().toISOString() });
          a.status = 'error';
          a.endedAt = new Date().toISOString();
          this.emit('statusChange', this.serialize(a));
        });

      return this.serialize(agentInfo);
    }

    // provider === 'claude' (default)
    agentInfo.status = 'active';
    this.emit('spawned', this.serialize(agentInfo));
    spawnClaude(this, { id, prompt, projectDir, model, effort, allowedTools, resumeFrom });
    return this.serialize(agentInfo);
  }

  /**
   * Agrega un log a un agente y emite el evento
   */
  addLog(agentId, logEntry) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Mantener máximo 1000 logs en memoria
    if (agent.logs.length >= 1000) {
      agent.logs.shift();
    }
    agent.logs.push(logEntry);
    this.emit('log', agentId, logEntry);
  }

  /**
   * Detiene un agente (solo soportado para providers con proceso propio)
   */
  async stop(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || !agent._process) return false;

    return new Promise((resolve) => {
      const pid = agent._process.pid;
      if (!pid) {
        resolve(false);
        return;
      }

      log.info(`Deteniendo agente ${agentId} (PID: ${pid})`);
      agent.status = 'stopping';
      this.emit('statusChange', this.serialize(agent));

      treeKill(pid, 'SIGTERM', () => {
        agent.status = 'stopped';
        agent.endedAt = new Date().toISOString();
        this.emit('statusChange', this.serialize(agent));
        resolve(true);
      });
    });
  }

  /**
   * Obtiene un agente por ID
   */
  get(agentId) {
    const agent = this.agents.get(agentId);
    return agent ? this.serialize(agent) : null;
  }

  /**
   * Lista todos los agentes
   */
  getAll() {
    return Array.from(this.agents.values()).map((a) => this.serialize(a));
  }

  /**
   * Serializa un agente para enviar al frontend (sin _process)
   */
  serialize(agent) {
    const { _process, ...rest } = agent;
    return { ...rest, logs: rest.logs?.slice(-50) || [] };
  }
}

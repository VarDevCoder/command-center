// Gestor de agentes Claude Code en modo headless
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentMgr');

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
  }

  /**
   * Spawna un nuevo agente Claude Code en modo headless
   */
  spawn({ prompt, projectDir, model = 'sonnet', allowedTools, resumeFrom }) {
    const id = `agent-${++this.counter}-${Date.now()}`;

    // Modo headless sin prompts de permisos
    const args = ['--print', '--dangerously-skip-permissions'];

    // Si es un resume de sesión anterior
    if (resumeFrom) {
      args.unshift('--resume', resumeFrom);
    }

    // Modelo
    if (model && model !== 'sonnet') {
      args.push('--model', model);
    }

    // Permisos de herramientas
    if (allowedTools?.length) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    log.info(`Spawning agente ${id} en ${projectDir}`);
    log.info(`Comando: claude ${args.join(' ')}`);

    // Limpiar env vars que bloquean sesiones anidadas
    const env = { ...process.env };
    delete env.CLAUDE_CODE;
    delete env.CLAUDECODE;

    const child = spawn('claude', args, {
      cwd: projectDir,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const agentInfo = {
      id,
      pid: child.pid,
      status: 'spawning',
      prompt: prompt.slice(0, 200),
      projectDir,
      model,
      startedAt: new Date().toISOString(),
      logs: [],
      sessionId: null,
      tokensIn: 0,
      tokensOut: 0,
    };

    this.agents.set(id, agentInfo);

    // Enviar prompt por stdin
    child.stdin.write(prompt);
    child.stdin.end();

    // Procesar stdout
    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleOutput(id, line);
      }
    });

    // Procesar stderr (errores y warnings)
    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (!text) return;
      this.addLog(id, {
        type: 'error',
        content: text,
        timestamp: new Date().toISOString(),
      });
    });

    // Proceso terminado
    child.on('close', (code) => {
      const agent = this.agents.get(id);
      if (agent) {
        agent.status = code === 0 ? 'completed' : 'error';
        agent.exitCode = code;
        agent.endedAt = new Date().toISOString();
        this.emit('statusChange', this.serialize(agent));
        log.info(`Agente ${id} terminó con código ${code}`);
      }
    });

    child.on('error', (err) => {
      log.error(`Error en agente ${id}: ${err.message}`);
      const agent = this.agents.get(id);
      if (agent) {
        agent.status = 'error';
        agent.endedAt = new Date().toISOString();
        this.emit('statusChange', this.serialize(agent));
      }
    });

    // Guardar referencia al proceso
    agentInfo._process = child;
    agentInfo.status = 'active';
    this.emit('spawned', this.serialize(agentInfo));

    return this.serialize(agentInfo);
  }

  /**
   * Procesa una línea de output del agente
   */
  handleOutput(agentId, line) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Intentar parsear como JSON (stream-json format)
    try {
      const data = JSON.parse(line);

      // Extraer sessionId si está disponible
      if (data.session_id && !agent.sessionId) {
        agent.sessionId = data.session_id;
      }

      this.addLog(agentId, {
        type: data.type || 'output',
        content: data.content || data.text || line,
        timestamp: new Date().toISOString(),
        raw: data,
      });
    } catch {
      // Output de texto plano
      if (line.trim()) {
        this.addLog(agentId, {
          type: 'output',
          content: line,
          timestamp: new Date().toISOString(),
        });
      }
    }
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
   * Detiene un agente
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

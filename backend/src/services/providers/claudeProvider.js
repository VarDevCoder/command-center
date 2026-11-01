// Provider Claude Code — spawn headless, streaming de logs vía stdout JSON
import { spawn } from 'node:child_process';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ClaudeProvider');

/**
 * Spawna un agente Claude Code en modo headless. Escribe directamente en el
 * estado del AgentManager (agentInfo ya debe estar registrado en manager.agents)
 * y usa manager.addLog / manager.serialize / manager.emit para notificar.
 */
export function spawnClaude(manager, { id, prompt, projectDir, model = 'sonnet', effort, allowedTools, resumeFrom }) {
  const args = ['--print', '--dangerously-skip-permissions'];

  if (resumeFrom) {
    args.unshift('--resume', resumeFrom);
  }
  if (model && model !== 'sonnet') {
    args.push('--model', model);
  }
  if (effort) {
    args.push('--effort', effort);
  }
  if (allowedTools?.length) {
    args.push('--allowedTools', allowedTools.join(','));
  }

  log.info(`Spawning agente ${id} en ${projectDir}`);
  log.info(`Comando: claude ${args.join(' ')}`);

  const env = { ...process.env };
  delete env.CLAUDE_CODE;
  delete env.CLAUDECODE;

  const child = spawn('claude', args, {
    cwd: projectDir,
    env,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const agent = manager.agents.get(id);
  agent._process = child;

  child.stdin.write(prompt);
  child.stdin.end();

  let buffer = '';
  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      handleOutput(manager, id, line);
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (!text) return;
    manager.addLog(id, {
      type: 'error',
      content: text,
      timestamp: new Date().toISOString(),
    });
  });

  child.on('close', (code) => {
    const a = manager.agents.get(id);
    if (a) {
      a.status = code === 0 ? 'completed' : 'error';
      a.exitCode = code;
      a.endedAt = new Date().toISOString();
      manager.emit('statusChange', manager.serialize(a));
      log.info(`Agente ${id} terminó con código ${code}`);
    }
  });

  child.on('error', (err) => {
    log.error(`Error en agente ${id}: ${err.message}`);
    const a = manager.agents.get(id);
    if (a) {
      a.status = 'error';
      a.endedAt = new Date().toISOString();
      manager.emit('statusChange', manager.serialize(a));
    }
  });
}

function handleOutput(manager, agentId, line) {
  const agent = manager.agents.get(agentId);
  if (!agent) return;

  try {
    const data = JSON.parse(line);

    if (data.session_id && !agent.sessionId) {
      agent.sessionId = data.session_id;
    }

    manager.addLog(agentId, {
      type: data.type || 'output',
      content: data.content || data.text || line,
      timestamp: new Date().toISOString(),
      raw: data,
    });
  } catch {
    if (line.trim()) {
      manager.addLog(agentId, {
        type: 'output',
        content: line,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * Invocación simple no interactiva de Claude Code (usada por el revisor de
 * tareas y por el pipeline supervisado): spawnea, espera el resultado
 * completo, devuelve el texto. No registra nada en el AgentManager — es un
 * uso puntual y aislado.
 */
export function runClaudeOnce({ prompt, projectDir, model = 'sonnet', effort, allowedTools, resumeFrom }) {
  return runClaudeOnceDetailed({ prompt, projectDir, model, effort, allowedTools, resumeFrom })
    .then((r) => r.replyText);
}

/**
 * Igual que runClaudeOnce, pero devuelve también el sessionId — necesario
 * para el pipeline supervisado, que debe poder resumir la misma sesión en
 * un reintento de corrección (FIX-NEEDED).
 */
export function runClaudeOnceDetailed({ prompt, projectDir, model = 'sonnet', effort, allowedTools, resumeFrom }) {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
    if (resumeFrom) args.unshift('--resume', resumeFrom);
    if (model && model !== 'sonnet') args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (allowedTools?.length) args.push('--allowedTools', allowedTools.join(','));

    log.info(`claude ${args.join(' ')} en ${projectDir}`);

    const env = { ...process.env };
    delete env.CLAUDE_CODE;
    delete env.CLAUDECODE;

    const child = spawn('claude', args, {
      cwd: projectDir,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    let buffer = '';
    let replyText = '';
    let sessionId = resumeFrom || null;
    let stderrText = '';

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.session_id) sessionId = evt.session_id;
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
      resolve({ replyText: replyText || '(sin respuesta)', sessionId });
    });

    child.on('error', (err) => reject(err));
  });
}

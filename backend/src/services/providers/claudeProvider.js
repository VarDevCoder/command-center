// Provider Claude Code — spawn headless, streaming de logs vía stdout JSON
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ClaudeProvider');
const CLAUDE_EXE = process.env.CLAUDE_CLI_PATH || (process.platform === 'win32'
  ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  : 'claude');

/**
 * Spawna un agente Claude Code en modo headless. Escribe directamente en el
 * estado del AgentManager (agentInfo ya debe estar registrado en manager.agents)
 * y usa manager.addLog / manager.serialize / manager.emit para notificar.
 */
export function spawnClaude(manager, { id, prompt, projectDir, model = 'sonnet', effort, allowedTools, resumeFrom }) {
  // stream-json: sin él no se conoce el id de sesión (no se puede retomar) ni el consumo.
  const args = ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];

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

  const child = spawn(CLAUDE_EXE, args, {
    cwd: projectDir,
    env,
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
      manager.addLog(id, { type: 'error', content: err.message, timestamp: new Date().toISOString() });
      a.status = 'error';
      a.exitCode = err.code || null;
      a.endedAt = new Date().toISOString();
      manager.emit('statusChange', manager.serialize(a));
    }
  });
}

export function handleOutput(manager, agentId, line) {
  const agent = manager.agents.get(agentId);
  if (!agent) return;
  const addLog = (entry) => manager.addLog(agentId, { ...entry, timestamp: new Date().toISOString() });

  let data;
  try {
    data = JSON.parse(line);
  } catch {
    addLog({ type: 'output', content: line });
    return;
  }

  if (data.session_id) agent.sessionId = data.session_id;

  if (data.type === 'assistant') {
    for (const block of data.message?.content ?? []) {
      if (block.type === 'text' && block.text?.trim()) addLog({ type: 'assistant', content: block.text });
      if (block.type === 'tool_use') {
        addLog({ type: 'tool_use', toolName: block.name, content: JSON.stringify(block.input ?? {}).slice(0, 300) });
      }
    }
    return;
  }

  if (data.type === 'result') {
    agent.result = data.result || agent.result;
    const usage = data.usage ?? {};
    agent.tokensIn += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    agent.tokensOut += usage.output_tokens ?? 0;
    if (data.is_error) addLog({ type: 'error', content: data.result || 'Claude Code terminó con error' });
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

    const child = spawn(CLAUDE_EXE, args, {
      cwd: projectDir,
      env,
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

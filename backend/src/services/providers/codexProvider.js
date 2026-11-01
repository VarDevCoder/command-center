// Provider Codex/GPT — invocación no interactiva vía Codex CLI (cuenta ChatGPT)
import { spawn } from 'node:child_process';
import { createLogger } from '../../utils/logger.js';
import { PATHS } from '../../utils/paths.js';

const log = createLogger('CodexProvider');

/**
 * Corre un prompt no interactivo con Codex CLI. No hace streaming (Codex solo
 * entrega el resultado al final del turno) — devuelve { replyText, threadId }.
 */
export function run({ prompt, projectDir, model, effort, resumeFrom }) {
  return new Promise((resolve, reject) => {
    const baseArgs = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config'];
    const args = resumeFrom
      ? ['exec', 'resume', resumeFrom, prompt, '--json', '--skip-git-repo-check', '--ignore-user-config']
      : [...baseArgs, prompt];

    if (model) args.push('-m', model);
    // Codex CLI no tiene --effort; el nivel de razonamiento se setea vía override de config.
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);

    log.info(`codex ${args.join(' ')}`.slice(0, 150));

    // shell:true en Windows no cita args con espacios automáticamente —
    // hay que citarlos a mano antes de pasarlos al shell.
    const quotedArgs = args.map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));

    const child = spawn('codex', quotedArgs, {
      cwd: projectDir || PATHS.workspace,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let replyText = '';
    let threadId = resumeFrom || null;
    let errorMsg = null;
    let stderrText = '';

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'thread.started' && evt.thread_id) {
            threadId = evt.thread_id;
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

    child.stderr.on('data', (data) => { stderrText += data.toString(); });

    child.on('close', (code) => {
      if (errorMsg) return reject(new Error(errorMsg));
      if (code !== 0 && !replyText) {
        return reject(new Error(stderrText.trim() || `Codex terminó con código ${code}`));
      }
      resolve({ replyText: replyText || '(sin respuesta)', threadId });
    });

    child.on('error', (err) => reject(err));
  });
}

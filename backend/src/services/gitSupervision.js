// Helpers compartidos de git worktree + revisión, usados por el pipeline
// supervisado de todos los proveedores (Claude/Codex/Ollama).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createLogger } from '../utils/logger.js';
import { runClaudeOnce } from './providers/claudeProvider.js';

const log = createLogger('GitSupervision');
const execFileAsync = promisify(execFile);

const REVIEW_PROMPT = 'Review the changes in this git worktree. Run git diff against the base branch, read changed files as needed, and report one of APPROVE / REJECT / FIX-NEEDED with notes explaining why.';
const REVIEW_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff)', 'Bash(git log)', 'Bash(git status)'];

// Heurística de detección de "esta tarea va a modificar archivos" —
// deliberadamente inclusiva: prefiere falsos positivos. Una tarea de solo
// lectura que entra en modo protegido de más no hace daño (si el diff
// termina vacío, no se abre PR igual). No existe forma de interceptar una
// tarea a mitad de camino con certeza (se evaluó y descartó un hook de
// permisos de Claude Code CLI que no se pudo confirmar como capacidad real
// de esta versión), así que la decisión se toma antes de lanzar.
const MODIFY_KEYWORDS = /\b(arregl\w*|implement\w*|agreg\w*|a[ñn]ad\w*|modific\w*|refactoriz\w*|elimin\w*|borr\w*|cre\w*|instal\w*|actualiz\w*|cambi\w*|corrig\w*|escrib\w*|mov\w*|renombr\w*|sobreescrib\w*|configur\w*|despleg\w*|optimiz\w*|limpi\w*)\w*\b/i;

export function looksLikeModification(prompt) {
  return MODIFY_KEYWORDS.test(prompt || '');
}

/**
 * Crea un git worktree aislado con su propia rama, a partir del checkout
 * real del repo. Nunca toca el checkout principal.
 */
export async function createWorktree(projectDir, taskId, branchPrefix) {
  const branch = `${branchPrefix}/${taskId}`;
  const worktreePath = join(projectDir, '..', '.worktrees', taskId);
  await mkdir(join(projectDir, '..', '.worktrees'), { recursive: true });
  await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branch], { cwd: projectDir });
  log.info(`Worktree creado: ${worktreePath} (rama ${branch})`);
  return { worktreePath, branch };
}

/**
 * Remueve un worktree. Nunca borra la rama — el usuario decide si mergea
 * o descarta el trabajo.
 */
export async function removeWorktree(worktreePath, projectDir) {
  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd: projectDir });
    log.info(`Worktree removido: ${worktreePath}`);
  } catch (err) {
    log.error(`Error removiendo worktree ${worktreePath}: ${err.message}`);
  }
}

/**
 * Revisor de solo lectura: corre un Claude Code restringido a herramientas
 * de lectura + git diff/log/status, y devuelve un veredicto parseado.
 */
export async function reviewWorktree(worktreePath, { extraContext } = {}) {
  try {
    const prompt = extraContext ? `${REVIEW_PROMPT}\n\n${extraContext}` : REVIEW_PROMPT;
    const replyText = await runClaudeOnce({
      prompt,
      projectDir: worktreePath,
      model: 'sonnet',
      allowedTools: REVIEW_ALLOWED_TOOLS,
    });

    const verdictMatch = replyText.match(/\b(APPROVE|REJECT|FIX-NEEDED)\b/i);
    return {
      verdict: verdictMatch ? verdictMatch[1].toUpperCase() : 'FIX-NEEDED',
      notes: replyText,
    };
  } catch (err) {
    return { verdict: 'ERROR', notes: `No se pudo revisar: ${err.message}` };
  }
}

/**
 * Resumen de cambios (git diff --stat) contra la rama base — usado para
 * detectar "sin cambios reales" (no hace falta PR) y para mostrar en la UI.
 */
export async function getDiffStat(worktreePath, baseBranch) {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--stat', `${baseBranch}...HEAD`], { cwd: worktreePath });
    return stdout.trim();
  } catch (err) {
    log.error(`Error obteniendo diff stat: ${err.message}`);
    return '';
  }
}

/**
 * Lista de commits de la rama de trabajo, para el audit trail / UI.
 */
export async function getCommits(worktreePath, baseBranch) {
  try {
    const { stdout } = await execFileAsync('git', ['log', `${baseBranch}..HEAD`, '--format=%H|%s|%ci'], { cwd: worktreePath });
    return stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [sha, subject, date] = line.split('|');
      return { sha, subject, date };
    });
  } catch (err) {
    log.error(`Error obteniendo commits: ${err.message}`);
    return [];
  }
}

/**
 * SHA del HEAD actual del worktree — usado para trackear qué commit fue
 * aprobado por el revisor, e invalidar aprobaciones viejas si cambia.
 */
export async function getHeadSha(worktreePath) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath });
  return stdout.trim();
}

/**
 * Publica la rama de trabajo al remoto. Es el ÚNICO lugar de todo el
 * sistema que corre `git push`, y solo empuja la rama feature — nunca la
 * rama base.
 */
export async function pushBranch(worktreePath, branch) {
  await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: worktreePath });
  log.info(`Rama publicada: ${branch}`);
}

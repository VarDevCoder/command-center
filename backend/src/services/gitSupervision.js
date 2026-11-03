// Helpers compartidos de git worktree + revisión, usados por el pipeline
// supervisado de todos los proveedores (Claude/Codex/Ollama).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createLogger } from '../utils/logger.js';
import * as codexProvider from './providers/codexProvider.js';
import { parseGitHubFullName } from './repoLocator.js';

const log = createLogger('GitSupervision');
const execFileAsync = promisify(execFile);

const REVIEW_MODEL = process.env.CODEX_REVIEW_MODEL || 'gpt-6.1-sol';
const REVIEW_EFFORT = process.env.CODEX_REVIEW_EFFORT || 'max';
const REVIEW_PROMPT = `Actuá como revisor técnico de solo lectura. Revisá todos los cambios de este git worktree contra la rama base usando git diff, git log y los archivos modificados. No edites archivos, no hagas commits y no cambies el repositorio.

Emití exactamente uno de estos veredictos y explicá los hallazgos con archivo y línea cuando corresponda:
- APPROVE: el cambio es correcto, seguro y verificable.
- FIX-NEEDED: hay problemas corregibles antes de aprobar.
- REJECT: existe un riesgo grave o el enfoque no debe publicarse.`;

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
 * Revisor de solo lectura: usa Codex con razonamiento máximo dentro del
 * sandbox read-only y devuelve un veredicto parseado.
 */
export async function reviewWorktree(worktreePath, { extraContext } = {}) {
  try {
    const prompt = extraContext ? `${REVIEW_PROMPT}\n\n${extraContext}` : REVIEW_PROMPT;
    const { replyText } = await codexProvider.run({
      prompt,
      projectDir: worktreePath,
      model: REVIEW_MODEL,
      effort: REVIEW_EFFORT,
      sandbox: 'read-only',
    });

    const verdictMatch = replyText.match(/\b(APPROVE|REJECT|FIX-NEEDED)\b/i);
    return {
      verdict: verdictMatch ? verdictMatch[1].toUpperCase() : 'FIX-NEEDED',
      notes: replyText,
      reviewer: { provider: 'codex', model: REVIEW_MODEL, effort: REVIEW_EFFORT },
    };
  } catch (err) {
    return {
      verdict: 'ERROR',
      notes: `No se pudo revisar con Codex: ${err.message}`,
      reviewer: { provider: 'codex', model: REVIEW_MODEL, effort: REVIEW_EFFORT },
    };
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

/**
 * "owner/repo" según el remote origin del checkout, o null si no es de GitHub.
 */
export async function resolveRepoFullNameFromLocalRepo(projectDir) {
  try {
    const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], { cwd: projectDir });
    return parseGitHubFullName(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Raíz del repo git que contiene `dir`. Falla si la ruta no existe o no es un repo.
 */
export async function resolveLocalRepoDir(dir) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
    return resolve(stdout.trim());
  } catch {
    throw new Error(`"${dir}" no es un repositorio git local`);
  }
}

/**
 * Rama base según el propio checkout: la rama por defecto de `origin` o, si el
 * remoto no responde, la rama actual. Null si ninguna es válida.
 */
export async function resolveBaseBranchFromLocalRepo(projectDir) {
  try {
    const { stdout } = await execFileAsync(
      'git', ['remote', 'show', 'origin'],
      { cwd: projectDir }
    );
    const match = stdout.match(/HEAD branch:\s*(\S+)/);
    if (match && match[1] && match[1] !== '(unknown)') return match[1];
  } catch (err) {
    log.error(`No se pudo leer HEAD branch de origin en ${projectDir}: ${err.message}`);
  }

  try {
    const { stdout } = await execFileAsync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: projectDir }
    );
    const branch = stdout.trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch (err) {
    log.error(`No se pudo determinar la rama actual en ${projectDir}: ${err.message}`);
  }

  return null;
}

// Capa de Pull Requests — todas las llamadas a `gh pr *` del sistema viven
// acá, para que haya un solo lugar que sepa crear/listar/mergear PRs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PrService');
const execFileAsync = promisify(execFile);

/**
 * Busca un PR ya abierto para esta rama (evita duplicados en reintentos).
 */
export async function findExistingPr(worktreePath, branch) {
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'list', '--head', branch, '--state', 'open',
      '--json', 'number,url,state',
    ], { cwd: worktreePath });
    const prs = JSON.parse(stdout);
    return prs[0] || null;
  } catch (err) {
    log.error(`Error buscando PR existente para ${branch}: ${err.message}`);
    return null;
  }
}

/**
 * Crea un PR real en GitHub. No pushea — eso ya debe haberse hecho antes
 * (ver gitSupervision.pushBranch).
 */
export async function createPr({ worktreePath, branch, baseBranch, title, body }) {
  const { stdout } = await execFileAsync('gh', [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--base', baseBranch,
    '--head', branch,
  ], { cwd: worktreePath });

  // gh pr create imprime la URL del PR creado en stdout
  const url = stdout.trim().split('\n').pop();
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return { number: numberMatch ? Number(numberMatch[1]) : null, url };
}

/**
 * Mergea un PR real — nunca un push directo a la rama base. gh respeta
 * cualquier protección de rama/checks obligatorios configurados en GitHub.
 */
export async function mergePr({ worktreePath, prNumber }) {
  await execFileAsync('gh', ['pr', 'merge', String(prNumber), '--merge'], { cwd: worktreePath });
  log.info(`PR #${prNumber} mergeado`);
}

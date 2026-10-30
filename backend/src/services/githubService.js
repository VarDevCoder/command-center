// Servicio de integración con GitHub (vía gh CLI) — reemplaza el escaneo local de proyectos
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { PATHS } from '../utils/paths.js';
import { repoLocator } from './repoLocator.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GitHub');
const execFileAsync = promisify(execFile);

/**
 * Lista los repositorios del usuario autenticado en gh CLI, cruzados con
 * los clones reales encontrados en el disco (repoLocator), sin importar
 * en qué carpeta o con qué nombre estén clonados.
 */
export async function listRepos({ limit = 100 } = {}) {
  const { stdout } = await execFileAsync('gh', [
    'repo', 'list',
    '--limit', String(limit),
    '--json', 'name,nameWithOwner,description,url,updatedAt,isPrivate,defaultBranchRef',
  ]);

  const repos = JSON.parse(stdout);

  const withLocalState = await Promise.all(
    repos.map(async (r) => {
      const foundDir = repoLocator.getDir(r.nameWithOwner);
      const fallbackDir = join(PATHS.workspace, r.name);
      const localDir = foundDir || fallbackDir;
      const clonedLocally = foundDir ? true : await dirExists(fallbackDir);

      return {
        name: r.name,
        fullName: r.nameWithOwner,
        description: r.description || '',
        url: r.url,
        updatedAt: r.updatedAt,
        isPrivate: r.isPrivate,
        defaultBranch: r.defaultBranchRef?.name || 'main',
        dir: localDir,
        clonedLocally,
      };
    })
  );

  return withLocalState.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Estado del escaneo de disco en background (para mostrar en el UI)
 */
export function getScanStatus() {
  return repoLocator.getStatus();
}

/**
 * Relanza el escaneo de disco en background
 */
export function rescanDisk() {
  repoLocator.startScan();
}

/**
 * Clona un repo (por nameWithOwner, ej "VarDevCoder/Lentes") al workspace local si no existe aún.
 * Devuelve el path local del repo.
 */
export async function ensureCloned(fullName, repoName) {
  const foundDir = repoLocator.getDir(fullName);
  if (foundDir) return foundDir;

  const localDir = join(PATHS.workspace, repoName);
  if (await dirExists(localDir)) {
    return localDir;
  }

  log.info(`Clonando ${fullName} en ${localDir}`);
  await execFileAsync('gh', ['repo', 'clone', fullName, localDir]);
  return localDir;
}

async function dirExists(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

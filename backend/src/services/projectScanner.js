// Escanea el workspace para encontrar proyectos
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Scanner');

/**
 * Escanea C:/Dev/Desarrollo/ para proyectos con patrón XX-nombre
 */
export async function scanProjects() {
  const workspace = PATHS.workspace;
  const entries = await readdir(workspace, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // Detectar patrón XX-nombre o similar
    const match = entry.name.match(/^(\d{2})-(.+)$/);
    if (!match) continue;

    const projectDir = join(workspace, entry.name);
    const [, num, slug] = match;

    // Verificar subdirectorios
    const hasBackend = await dirExists(join(projectDir, 'backend'));
    const hasFrontend = await dirExists(join(projectDir, 'frontend'));
    const hasPackageJson = await fileExists(join(projectDir, 'package.json'));

    projects.push({
      id: num,
      slug,
      name: entry.name,
      dir: projectDir,
      hasBackend,
      hasFrontend,
      hasPackageJson,
    });
  }

  log.info(`Encontrados ${projects.length} proyectos`);
  return projects.sort((a, b) => a.id.localeCompare(b.id));
}

async function dirExists(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

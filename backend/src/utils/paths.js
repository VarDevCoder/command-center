// Constantes de rutas del sistema Claude Code
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const CLAUDE_DIR = process.env.CLAUDE_HOME || join(HOME, '.claude');
const WORKSPACE = process.env.WORKSPACE_DIR || 'C:/Dev/Desarrollo';

export const PATHS = {
  claudeDir: CLAUDE_DIR,
  projectsDir: join(CLAUDE_DIR, 'projects'),
  historyFile: join(CLAUDE_DIR, 'history.jsonl'),
  debugDir: join(CLAUDE_DIR, 'debug'),
  tasksDir: join(CLAUDE_DIR, 'tasks'),
  workspace: WORKSPACE,
};

/**
 * Convierte una ruta de proyecto a su nombre de directorio en .claude/projects/
 * Ej: "C:\Dev\Desarrollo" -> "C--Dev-Desarrollo"
 * El patrón real: cada caracter especial (\, /, :) se reemplaza por "-"
 */
export function projectPathToDir(projectPath) {
  return projectPath
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/:/g, '-');
}

/**
 * Obtiene el directorio de sesiones para un proyecto específico
 */
export function getProjectSessionsDir(projectPath) {
  const dirName = projectPathToDir(projectPath);
  return join(PATHS.projectsDir, dirName);
}

// Localiza repos git clonados en cualquier parte del disco, leyendo su remote origin.
// Corre en background: no bloquea el arranque del servidor ni las requests.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('RepoLocator');

// Carpetas que nunca vale la pena bajar a escanear
const SKIP_DIRS = new Set([
  'node_modules', '.git', '$Recycle.Bin', 'System Volume Information',
  'Windows', 'ProgramData', '$WinREAgent', '$SysReset',
  'AppData', '.cache', '.npm', '.cargo', '.rustup', 'venv', '.venv',
  'dist', 'build', '.next', '.nuxt', 'target', 'obj', 'bin',
]);

const MAX_DEPTH = 10;

class RepoLocator {
  constructor() {
    // nameWithOwner ("owner/repo") -> directorio local absoluto
    this.byFullName = new Map();
    this.status = 'idle'; // idle | scanning | done
    this.scannedAt = null;
    this.dirsVisited = 0;
  }

  getDir(fullName) {
    return this.byFullName.get(fullName.toLowerCase()) || null;
  }

  getStatus() {
    return { status: this.status, scannedAt: this.scannedAt, reposFound: this.byFullName.size };
  }

  /**
   * Lanza el escaneo completo del disco en background. No bloquea al llamador.
   */
  startScan() {
    if (this.status === 'scanning') return;
    this.status = 'scanning';
    this.dirsVisited = 0;
    log.info('Iniciando escaneo de disco en background...');

    this._scanDrive('C:\\')
      .then(() => {
        this.status = 'done';
        this.scannedAt = new Date().toISOString();
        log.info(`Escaneo completo: ${this.byFullName.size} repos encontrados (${this.dirsVisited} dirs visitados)`);
      })
      .catch((err) => {
        this.status = 'done';
        this.scannedAt = new Date().toISOString();
        log.error('Error en escaneo de disco:', err.message);
      });
  }

  async _scanDrive(root) {
    await this._walk(root, 0);
  }

  async _walk(dir, depth) {
    if (depth > MAX_DEPTH) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // sin permisos u otro error — seguir
    }

    this.dirsVisited++;

    // ¿Es este directorio un repo git?
    if (entries.some((e) => e.isDirectory() && e.name === '.git')) {
      await this._registerRepo(dir);
      return; // no bajar dentro de un repo ya identificado
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;

      await this._walk(join(dir, entry.name), depth + 1);
    }
  }

  async _registerRepo(dir) {
    try {
      const configPath = join(dir, '.git', 'config');
      const config = await readFile(configPath, 'utf8');
      const match = config.match(/url\s*=\s*(.+)/);
      if (!match) return;

      const fullName = parseGitHubFullName(match[1].trim());
      if (!fullName) return;

      // Si ya hay un clon registrado para este repo, preferir el primero encontrado
      if (!this.byFullName.has(fullName.toLowerCase())) {
        this.byFullName.set(fullName.toLowerCase(), dir);
      }
    } catch {
      // config ilegible — ignorar
    }
  }
}

/**
 * Extrae "owner/repo" de una URL remota de git (https o ssh)
 */
function parseGitHubFullName(url) {
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/i);
  if (!httpsMatch) return null;
  return `${httpsMatch[1]}/${httpsMatch[2].replace(/\.git$/, '')}`;
}

export const repoLocator = new RepoLocator();

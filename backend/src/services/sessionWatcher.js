// Watcher de archivos JSONL de sesiones en tiempo real
import { watch } from 'chokidar';
import { stat } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PATHS } from '../utils/paths.js';
import { readNewLines } from './sessionParser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Watcher');

export class SessionWatcher extends EventEmitter {
  constructor() {
    super();
    // Mapa de offsets por archivo: filePath -> bytes leídos
    this.offsets = new Map();
    this.watcher = null;
  }

  /**
   * Inicia el watcher de archivos JSONL
   */
  start() {
    const watchPath = `${PATHS.projectsDir}/**/*.jsonl`;
    log.info(`Watching: ${watchPath}`);

    this.watcher = watch(watchPath, {
      // Polling para Windows (fsevents no es confiable)
      usePolling: true,
      interval: 2000,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 200,
      },
    });

    this.watcher.on('add', (filePath) => this.handleNewFile(filePath));
    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('error', (err) => log.error('Watcher error:', err.message));

    log.info('Session watcher iniciado');
  }

  /**
   * Maneja un archivo nuevo de sesión
   */
  async handleNewFile(filePath) {
    log.info(`Nueva sesión detectada: ${filePath}`);
    this.offsets.set(filePath, 0);
    await this.handleChange(filePath);
  }

  /**
   * Maneja cambios en un archivo JSONL existente
   */
  async handleChange(filePath) {
    try {
      const currentOffset = this.offsets.get(filePath) || 0;
      const fileStat = await stat(filePath);

      // Si el archivo no creció, ignorar
      if (fileStat.size <= currentOffset) return;

      const { entries, newOffset } = await readNewLines(filePath, currentOffset);
      this.offsets.set(filePath, newOffset);

      // Emitir cada entrada nueva
      for (const entry of entries) {
        if (entry.sessionId) {
          this.emit('message', entry.sessionId, entry);
        }
      }
    } catch (err) {
      log.error(`Error procesando ${filePath}: ${err.message}`);
    }
  }

  /**
   * Detiene el watcher
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      log.info('Session watcher detenido');
    }
  }
}

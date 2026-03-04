// Rutas de historial de sesiones
import { Router } from 'express';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { parseSessionFile, getSessionMeta } from '../services/sessionParser.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const log = createLogger('Sessions');

/**
 * GET /api/v1/sessions — lista de sesiones recientes
 * Lee history.jsonl + archivos de sesión en projects/
 */
router.get('/', async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const sessions = await getRecentSessions(limit);
    res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/sessions/:id — mensajes de una sesión específica
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const filePath = await findSessionFile(id);

    if (!filePath) {
      return res.status(404).json({
        success: false,
        error: { message: 'Sesión no encontrada' },
      });
    }

    const entries = await parseSessionFile(filePath);
    const meta = await getSessionMeta(filePath);

    res.json({ success: true, data: { ...meta, entries } });
  } catch (err) {
    next(err);
  }
});

/**
 * Lee las sesiones recientes desde history.jsonl
 */
async function getRecentSessions(limit) {
  try {
    const content = await readFile(PATHS.historyFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);

    // Parsear y deduplicar por sessionId
    const sessionMap = new Map();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.sessionId) continue;

        const existing = sessionMap.get(entry.sessionId);
        if (!existing || entry.timestamp > existing.timestamp) {
          sessionMap.set(entry.sessionId, {
            sessionId: entry.sessionId,
            preview: entry.display?.slice(0, 120) || '',
            timestamp: entry.timestamp,
            project: entry.project || '',
          });
        }
      } catch {
        // Ignorar líneas inválidas
      }
    }

    // Ordenar por timestamp descendente y limitar
    return Array.from(sessionMap.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  } catch (err) {
    log.error('Error leyendo history.jsonl:', err.message);
    return [];
  }
}

/**
 * Busca el archivo JSONL de una sesión por su ID en todos los directorios de proyectos
 */
async function findSessionFile(sessionId) {
  try {
    const projectDirs = await readdir(PATHS.projectsDir, {
      withFileTypes: true,
    });

    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const filePath = join(PATHS.projectsDir, dir.name, `${sessionId}.jsonl`);
      try {
        await readFile(filePath, { flag: 'r' });
        return filePath;
      } catch {
        // No existe en este directorio
      }
    }
  } catch (err) {
    log.error('Error buscando sesión:', err.message);
  }
  return null;
}

export default router;

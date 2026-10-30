// Rutas de proyectos — repos reales del usuario en GitHub
import { Router } from 'express';
import { z } from 'zod';
import { listRepos, ensureCloned, getScanStatus, rescanDisk } from '../services/githubService.js';

const router = Router();

/**
 * GET /api/v1/projects — lista de repos de GitHub del usuario autenticado
 */
router.get('/', async (req, res, next) => {
  try {
    const repos = await listRepos();
    res.json({ success: true, data: repos, meta: { scan: getScanStatus() } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/projects/scan-status — estado del escaneo de disco en background
 */
router.get('/scan-status', (req, res) => {
  res.json({ success: true, data: getScanStatus() });
});

/**
 * POST /api/v1/projects/rescan — relanza el escaneo de disco
 */
router.post('/rescan', (req, res) => {
  rescanDisk();
  res.json({ success: true, data: getScanStatus() });
});

/**
 * POST /api/v1/projects/clone — clona un repo al workspace si no está ya clonado
 * Body: { fullName: "owner/repo", name: "repo" }
 */
router.post('/clone', async (req, res, next) => {
  try {
    const { fullName, name } = z.object({
      fullName: z.string().min(1),
      name: z.string().min(1),
    }).parse(req.body);

    const dir = await ensureCloned(fullName, name);
    res.json({ success: true, data: { dir } });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: 'Input inválido', details: err.issues },
      });
    }
    next(err);
  }
});

export default router;

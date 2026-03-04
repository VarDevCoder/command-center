// Rutas de proyectos del workspace
import { Router } from 'express';
import { scanProjects } from '../services/projectScanner.js';

const router = Router();

/**
 * GET /api/v1/projects — lista de proyectos en el workspace
 */
router.get('/', async (req, res, next) => {
  try {
    const projects = await scanProjects();
    res.json({ success: true, data: projects });
  } catch (err) {
    next(err);
  }
});

export default router;

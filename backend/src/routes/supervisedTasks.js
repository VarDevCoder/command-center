// Rutas del pipeline supervisado (worktree + revisor + PR) — lectura de
// tareas, reintento de publicación, y el único punto de entrada a un merge
// real del sistema.
import { Router } from 'express';
import { supervisedAgentService } from '../services/supervisedAgentService.js';

const router = Router();

/**
 * GET /api/v1/supervised-tasks — lista con filtros opcionales
 */
router.get('/', async (req, res, next) => {
  try {
    const { project, provider, status, since } = req.query;
    const tasks = await supervisedAgentService.listTasks({ project, provider, status, since });
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/supervised-tasks/:id — detalle completo de una tarea
 */
router.get('/:id', async (req, res, next) => {
  try {
    const task = await supervisedAgentService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: { message: 'Tarea no encontrada' } });
    }
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/supervised-tasks/:id/publish — reintento manual de
 * publicación (push + PR) tras un publish-error
 */
router.post('/:id/publish', async (req, res, next) => {
  try {
    await supervisedAgentService.publishPR(req.params.id);
    const task = await supervisedAgentService.getTask(req.params.id);
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/supervised-tasks/:id/merge — único punto de entrada a un
 * merge real. Solo debe ser invocado desde el botón "Aprobar e integrar"
 * del frontend.
 */
router.post('/:id/merge', async (req, res, next) => {
  try {
    const task = await supervisedAgentService.mergePR(req.params.id);
    res.json({ success: true, data: task });
  } catch (err) {
    if (err.code === 'stale-approval') {
      return res.status(409).json({
        success: false,
        error: { message: 'El código cambió desde que se aprobó — hace falta una nueva revisión antes de mergear', code: 'stale-approval' },
      });
    }
    next(err);
  }
});

export default router;

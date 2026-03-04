// Rutas de gestión de terminales PTY
import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// Schema de validación para crear terminal
const createSchema = z.object({
  name: z.string().max(50).optional(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  cols: z.number().int().min(20).max(500).default(120),
  rows: z.number().int().min(5).max(200).default(30),
});

// Referencia al terminalManager (se inyecta desde index.js)
let terminalManager = null;

export function setTerminalManager(manager) {
  terminalManager = manager;
}

/**
 * GET /api/v1/terminals — lista de terminales activas
 */
router.get('/', (req, res) => {
  const terminals = terminalManager ? terminalManager.getAll() : [];
  res.json({ success: true, data: terminals });
});

/**
 * GET /api/v1/terminals/:id — detalle de una terminal
 */
router.get('/:id', (req, res) => {
  if (!terminalManager) {
    return res.status(503).json({
      success: false,
      error: { message: 'Terminal manager no disponible' },
    });
  }

  const term = terminalManager.get(req.params.id);
  if (!term) {
    return res.status(404).json({
      success: false,
      error: { message: 'Terminal no encontrada' },
    });
  }
  res.json({ success: true, data: term });
});

/**
 * POST /api/v1/terminals — crear nueva terminal
 */
router.post('/', (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);

    if (!terminalManager) {
      return res.status(503).json({
        success: false,
        error: { message: 'Terminal manager no disponible' },
      });
    }

    const term = terminalManager.create(data);
    res.status(201).json({ success: true, data: term });
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

/**
 * DELETE /api/v1/terminals/:id — matar y eliminar terminal
 */
router.delete('/:id', (req, res) => {
  if (!terminalManager) {
    return res.status(503).json({
      success: false,
      error: { message: 'Terminal manager no disponible' },
    });
  }

  const success = terminalManager.kill(req.params.id);
  if (!success) {
    return res.status(404).json({
      success: false,
      error: { message: 'Terminal no encontrada' },
    });
  }
  res.json({ success: true, message: 'Terminal eliminada' });
});

export default router;

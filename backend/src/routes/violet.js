// Rutas de chat con Violet
import { Router } from 'express';
import { z } from 'zod';
import { violetService } from '../services/violetService.js';

const router = Router();

/**
 * GET /api/v1/violet/history — historial de la conversación con Violet
 */
router.get('/history', async (req, res, next) => {
  try {
    const messages = await violetService.getHistory();
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/violet/chat — enviar un mensaje a Violet
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { text } = z.object({ text: z.string().min(1).max(8000) }).parse(req.body);
    const reply = await violetService.send(text);
    res.json({ success: true, data: reply });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: { message: 'Input inválido', details: err.issues },
      });
    }
    res.status(500).json({ success: false, error: { message: err.message } });
  }
});

export default router;

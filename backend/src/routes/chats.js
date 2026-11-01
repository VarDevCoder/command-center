// Rutas del apartado "Chats" — hablale directamente a Claude/Codex/Ollama de un repo
import { Router } from 'express';
import { z } from 'zod';
import { repoChatService } from '../services/repoChatService.js';

const router = Router();

const PROVIDER = z.enum(['claude', 'codex', 'ollama']);

/**
 * GET /api/v1/chats — lista de chats (repo + proveedor) con actividad
 */
router.get('/', async (req, res, next) => {
  try {
    const chats = await repoChatService.listChats();
    res.json({ success: true, data: chats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/chats/history?repoDir=...&provider=... — historial de ese chat
 */
router.get('/history', async (req, res, next) => {
  try {
    const { repoDir, provider } = z.object({
      repoDir: z.string().min(1),
      provider: PROVIDER.default('claude'),
    }).parse(req.query);
    const history = await repoChatService.getHistory(repoDir, provider);
    res.json({ success: true, data: history });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ success: false, error: { message: 'repoDir requerido' } });
    }
    next(err);
  }
});

/**
 * POST /api/v1/chats/send — envía un mensaje al proveedor elegido de un repo
 */
router.post('/send', async (req, res, next) => {
  try {
    const { repoDir, repoName, text, provider } = z.object({
      repoDir: z.string().min(1),
      repoName: z.string().min(1),
      text: z.string().min(1).max(8000),
      provider: PROVIDER.default('claude'),
    }).parse(req.body);

    const reply = await repoChatService.sendMessage(repoDir, repoName, text, provider);
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

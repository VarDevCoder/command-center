// Rutas de chat con Violet
import { Router } from 'express';
import { z } from 'zod';
import { violetService } from '../services/violetService.js';

const router = Router();

const imageSchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().min(1).max(12_000_000),
});

const chatSchema = z.object({
  text: z.string().max(8000).default(''),
  images: z.array(imageSchema).max(4).default([]),
}).refine(({ text, images }) => text.trim().length > 0 || images.length > 0, {
  message: 'Escribí un mensaje o adjuntá una imagen',
});

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

router.get('/attachments/:fileName', async (req, res, next) => {
  try {
    const attachment = violetService.getAttachment(req.params.fileName);
    res.type(attachment.mimeType).sendFile(attachment.path);
  } catch (err) {
    if (err.code === 'INVALID_ATTACHMENT') {
      return res.status(404).json({ success: false, error: { message: 'Imagen no encontrada' } });
    }
    next(err);
  }
});

/**
 * POST /api/v1/violet/chat — enviar un mensaje a Violet
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { text, images } = chatSchema.parse(req.body);
    const reply = await violetService.send(text.trim(), images);
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

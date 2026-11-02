import { Router } from 'express';
import { z } from 'zod';
import { vscodeAgentService } from '../services/vscodeAgentService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await vscodeAgentService.listSessions() }); } catch (err) { next(err); }
});

router.post('/open', async (req, res, next) => {
  try {
    const { projectDir } = z.object({ projectDir: z.string().min(1) }).parse(req.body);
    res.json({ success: true, data: await vscodeAgentService.openProject(projectDir) });
  } catch (err) { next(err); }
});

router.post('/stop', async (req, res, next) => {
  try {
    const { uri } = z.object({ uri: z.string().min(1) }).parse(req.body);
    res.json({ success: true, data: await vscodeAgentService.stop(uri) });
  } catch (err) { next(err); }
});

export default router;


import { Router } from 'express';
import { usageMetricsService } from '../services/usageMetricsService.js';

const router = Router();
router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await usageMetricsService.getSummary(req.query.days) }); } catch (err) { next(err); }
});
export default router;


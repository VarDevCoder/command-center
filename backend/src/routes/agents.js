// Rutas de gestión de agentes
import { Router } from 'express';
import { z } from 'zod';
import { ollamaAgentService } from '../services/ollamaAgentService.js';

const router = Router();

// Schema de validación para spawn
const spawnSchema = z.object({
  prompt: z.string().min(1).max(10000),
  projectDir: z.string().min(1),
  provider: z.enum(['claude', 'codex', 'ollama']).default('claude'),
  model: z.string().min(1).default('sonnet'),
  effort: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  allowedTools: z.array(z.string()).optional(),
  repoFullName: z.string().optional(),
});

// Referencia al agentManager (se inyecta desde index.js)
let agentManager = null;

export function setAgentManager(manager) {
  agentManager = manager;
}

/**
 * GET /api/v1/agents — lista de agentes activos
 */
router.get('/', (req, res) => {
  const agents = agentManager ? agentManager.getAll() : [];
  res.json({ success: true, data: agents });
});

/**
 * GET /api/v1/agents/ollama-tasks — lista de tareas Ollama (persistidas en disco)
 */
router.get('/ollama-tasks', async (req, res, next) => {
  try {
    const tasks = await ollamaAgentService.listTasks();
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/agents/ollama-tasks/:id — detalle de una tarea Ollama
 */
router.get('/ollama-tasks/:id', async (req, res, next) => {
  try {
    const task = await ollamaAgentService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: { message: 'Tarea no encontrada' } });
    }
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/agents/:id — detalle de un agente
 */
router.get('/:id', (req, res) => {
  if (!agentManager) {
    return res.status(503).json({
      success: false,
      error: { message: 'Agent manager no disponible' },
    });
  }

  const agent = agentManager.get(req.params.id);
  if (!agent) {
    return res.status(404).json({
      success: false,
      error: { message: 'Agente no encontrado' },
    });
  }
  res.json({ success: true, data: agent });
});

/**
 * POST /api/v1/agents — spawn un nuevo agente
 */
router.post('/', (req, res, next) => {
  try {
    const data = spawnSchema.parse(req.body);

    if (!agentManager) {
      return res.status(503).json({
        success: false,
        error: { message: 'Agent manager no disponible' },
      });
    }

    const agent = agentManager.spawn(data);
    res.status(201).json({ success: true, data: agent });
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
 * POST /api/v1/agents/:id/stop — detener un agente
 */
router.post('/:id/stop', async (req, res) => {
  if (!agentManager) {
    return res.status(503).json({
      success: false,
      error: { message: 'Agent manager no disponible' },
    });
  }

  const success = await agentManager.stop(req.params.id);
  if (!success) {
    return res.status(404).json({
      success: false,
      error: { message: 'Agente no encontrado o ya detenido' },
    });
  }
  res.json({ success: true, message: 'Agente detenido' });
});

/**
 * POST /api/v1/agents/:id/send — enviar mensaje a un agente
 * Nota: Esto crea una nueva sesión resumida, no inyecta en la existente
 */
router.post('/:id/send', (req, res, next) => {
  try {
    const { prompt } = z.object({ prompt: z.string().min(1) }).parse(req.body);

    if (!agentManager) {
      return res.status(503).json({
        success: false,
        error: { message: 'Agent manager no disponible' },
      });
    }

    const agent = agentManager.get(req.params.id);
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: { message: 'Agente no encontrado' },
      });
    }

    // Spawn nueva sesión que resume la anterior
    const newAgent = agentManager.spawn({
      prompt,
      projectDir: agent.projectDir,
      provider: agent.provider || 'claude',
      model: agent.model || 'sonnet',
      effort: agent.effort || undefined,
      resumeFrom: agent.sessionId,
    });

    res.json({ success: true, data: newAgent });
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

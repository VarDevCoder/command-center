// Driver Ollama para el pipeline supervisado — envuelve el turn-loop que
// ya vive en ollamaAgentService.js. Ollama no tiene concepto de "sesión"
// propio; la "sesión" es el taskId + el historial en memoria que mantiene
// ollamaAgentService entre turnos.
import { ollamaAgentService } from '../../ollamaAgentService.js';

export async function runInitial({ taskId, worktreePath, prompt, model }) {
  const { doneSummary } = await ollamaAgentService.runTurnLoop({
    taskId, worktreePath, prompt, model, resume: false,
  });
  return { sessionId: taskId, replyText: doneSummary };
}

export async function runRetry({ taskId, worktreePath, reviewNotes, model }) {
  const { doneSummary } = await ollamaAgentService.runTurnLoop({
    taskId, worktreePath, prompt: null, model, resume: true, reviewNotes,
  });
  return { sessionId: taskId, replyText: doneSummary };
}

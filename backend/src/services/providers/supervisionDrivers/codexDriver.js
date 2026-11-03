// Driver Codex para el pipeline supervisado — reusa codexProvider.run tal
// cual, apuntando al worktree en vez del checkout real.
import * as codexProvider from '../codexProvider.js';

// Los metadatos git de un worktree quedan fuera del sandbox de Codex: no puede
// commitear, así que el commit lo hace el pipeline (commitPendingChanges).
const WORK_INSTRUCTION = '\n\nDejá los cambios guardados en los archivos de este directorio; el sistema hace el commit. No ejecutes git add, git commit ni git push, y no toques ninguna otra rama.';
const SANDBOX = 'workspace-write';

export async function runInitial({ worktreePath, prompt, model, effort }) {
  const { replyText, threadId } = await codexProvider.run({
    prompt: `${prompt}${WORK_INSTRUCTION}`,
    projectDir: worktreePath,
    model,
    effort,
    sandbox: SANDBOX,
  });
  return { sessionId: threadId, replyText };
}

export async function runRetry({ worktreePath, sessionId, reviewNotes, model, effort }) {
  const prompt = `El revisor encontró problemas en tu trabajo. Corregilos en este mismo worktree:\n\n${reviewNotes}${WORK_INSTRUCTION}`;
  const { replyText, threadId } = await codexProvider.run({
    prompt,
    projectDir: worktreePath,
    model,
    effort,
    resumeFrom: sessionId,
    sandbox: SANDBOX,
  });
  return { sessionId: threadId || sessionId, replyText };
}

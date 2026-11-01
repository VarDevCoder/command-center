// Driver Claude para el pipeline supervisado — ejecuta directo contra un
// worktree, sin restricción de herramientas (el worktree es el sandbox).
import { runClaudeOnceDetailed } from '../claudeProvider.js';

const COMMIT_INSTRUCTION = '\n\nCuando termines los cambios, hacé commit de todo con `git add -A && git commit -m "..."` usando un mensaje descriptivo. No hagas push ni toques ninguna otra rama.';

export async function runInitial({ worktreePath, prompt, model, effort }) {
  const { sessionId, replyText } = await runClaudeOnceDetailed({
    prompt: `${prompt}${COMMIT_INSTRUCTION}`,
    projectDir: worktreePath,
    model,
    effort,
  });
  return { sessionId, replyText };
}

export async function runRetry({ worktreePath, sessionId, reviewNotes, model, effort }) {
  const prompt = `El revisor encontró problemas en tu trabajo. Corregilos en este mismo worktree:\n\n${reviewNotes}${COMMIT_INSTRUCTION}`;
  const { sessionId: newSessionId, replyText } = await runClaudeOnceDetailed({
    prompt,
    projectDir: worktreePath,
    model,
    effort,
    resumeFrom: sessionId,
  });
  return { sessionId: newSessionId || sessionId, replyText };
}

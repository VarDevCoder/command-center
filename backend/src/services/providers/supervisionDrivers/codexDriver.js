// Driver Codex para el pipeline supervisado — reusa codexProvider.run tal
// cual, apuntando al worktree en vez del checkout real.
import * as codexProvider from '../codexProvider.js';

const COMMIT_INSTRUCTION = '\n\nCuando termines los cambios, hacé commit de todo con `git add -A && git commit -m "..."` usando un mensaje descriptivo. No hagas push ni toques ninguna otra rama.';

export async function runInitial({ worktreePath, prompt, model, effort }) {
  const { replyText, threadId } = await codexProvider.run({
    prompt: `${prompt}${COMMIT_INSTRUCTION}`,
    projectDir: worktreePath,
    model,
    effort,
  });
  return { sessionId: threadId, replyText };
}

export async function runRetry({ worktreePath, sessionId, reviewNotes, model, effort }) {
  const prompt = `El revisor encontró problemas en tu trabajo. Corregilos en este mismo worktree:\n\n${reviewNotes}${COMMIT_INSTRUCTION}`;
  const { replyText, threadId } = await codexProvider.run({
    prompt,
    projectDir: worktreePath,
    model,
    effort,
    resumeFrom: sessionId,
  });
  return { sessionId: threadId || sessionId, replyText };
}

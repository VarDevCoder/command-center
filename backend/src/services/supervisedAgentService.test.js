import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { createWorktree, forbidsPublishing, parseReviewVerdict, reviewWorktree } from './gitSupervision.js';
import { createPr } from './prService.js';
import { runInitial, runRetry } from './providers/supervisionDrivers/claudeDriver.js';
import { supervisedAgentService as service } from './supervisedAgentService.js';
import { violetService } from './violetService.js';
import { listRepos } from './githubService.js';
import { AgentManager } from './agentManager.js';

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { mkdtempSync: mkdtemp } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: joinPath } = await import('node:path');
  const home = mkdtemp(joinPath(tmpdir(), 'cc-supervised-'));
  return { ...actual, PATHS: { ...actual.PATHS, claudeDir: joinPath(home, '.claude') } };
});
vi.mock('./gitSupervision.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reviewWorktree: vi.fn(),
}));
vi.mock('./prService.js', () => ({
  findExistingPr: vi.fn(async () => null),
  createPr: vi.fn(async () => ({ number: 1, url: 'https://github.com/acme/repo/pull/1' })),
  mergePr: vi.fn(),
}));
vi.mock('./githubService.js', () => ({ listRepos: vi.fn() }));
vi.mock('./providers/supervisionDrivers/claudeDriver.js', () => ({ runInitial: vi.fn(), runRetry: vi.fn() }));
vi.mock('./providers/supervisionDrivers/codexDriver.js', () => ({ runInitial: vi.fn(), runRetry: vi.fn() }));
vi.mock('./providers/supervisionDrivers/ollamaDriver.js', () => ({ runInitial: vi.fn(), runRetry: vi.fn() }));

const sandbox = dirname(PATHS.claudeDir);

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo({ withOrigin = true } = {}) {
  const root = mkdtempSync(join(sandbox, 'repo-'));
  const dir = join(root, 'checkout');
  mkdirSync(dir);
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'commit', '--allow-empty', '-m', 'inicial');

  const bare = join(root, 'origin.git').replace(/\\/g, '/');
  if (withOrigin) {
    git(root, 'init', '--bare', '-b', 'main', bare);
    git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/repo.git');
    git(dir, 'config', `url.${bare}.insteadOf`, 'https://github.com/acme/repo.git');
    git(dir, 'push', 'origin', 'main');
  }
  return { dir, bare };
}

function commitInWorktree({ worktreePath }) {
  writeFileSync(join(worktreePath, 'cambio.txt'), 'hecho');
  git(worktreePath, 'add', '-A');
  git(worktreePath, 'commit', '-m', 'cambio del agente');
  return { sessionId: 'sesion-1', replyText: 'listo' };
}

describe('pipeline supervisado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reviewWorktree.mockResolvedValue({ verdict: 'APPROVE', notes: 'ok', reviewer: { provider: 'codex', model: 'm', effort: 'max' } });
    runInitial.mockImplementation(async (args) => commitInWorktree(args));
  });

  it('sin repoFullName resuelve base y repo del checkout, corre al agente y publica', async () => {
    const { dir, bare } = makeRepo();

    await service.runProtected({ taskId: 'ok-1', projectDir: dir, prompt: 'arreglá algo', provider: 'claude', model: 'sonnet' });

    const task = await service.getTask('ok-1');
    expect(runInitial).toHaveBeenCalledOnce();
    expect(task.status).toBe('pr-open');
    expect(task.baseBranch).toBe('main');
    expect(task.repoFullName).toBe('acme/repo');
    expect(createPr).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: 'main', branch: 'claude/ok-1' }));
    expect(git(bare, 'branch', '--list', 'claude/ok-1')).toContain('claude/ok-1');
  });

  it('reintentar una tarea nunca aprobada no hace push ni abre PR', async () => {
    const { dir, bare } = makeRepo();
    const { worktreePath, branch } = await createWorktree(dir, 'legacy-1', 'claude');
    await service._saveTask({
      taskId: 'legacy-1', projectDir: dir, provider: 'claude', model: 'sonnet', prompt: 'x',
      worktreePath, branch, baseBranch: null, status: 'publish-error',
      reviewCycles: [], approvedSha: null, pr: null, lastError: 'error viejo',
    });

    await service.publishPR('legacy-1');

    const task = await service.getTask('legacy-1');
    expect(createPr).not.toHaveBeenCalled();
    expect(git(bare, 'branch', '--list', branch)).toBe('');
    expect(task.status).toBe('error');
    expect(task.lastError).toMatch(/no se publicó nada/);
  });

  it('sin rama base falla antes de crear el worktree y de lanzar al agente', async () => {
    const { dir } = makeRepo({ withOrigin: false });
    git(dir, 'checkout', '--detach');

    await service.runProtected({ taskId: 'sin-base-1', projectDir: dir, prompt: 'arreglá algo', provider: 'claude', model: 'sonnet' });

    const task = await service.getTask('sin-base-1');
    expect(runInitial).not.toHaveBeenCalled();
    expect(task.status).toBe('error');
    expect(task.lastError).toMatch(/rama base/);
    expect(task.worktreePath).toBeNull();
    expect(existsSync(join(dir, '..', '.worktrees'))).toBe(false);
  });
});

describe('rechazos del revisor', () => {
  const reviewer = { provider: 'codex', model: 'm', effort: 'max' };
  const REJECTED = { verdict: 'REJECT', notes: 'VEREDICTO: REJECT\nFalta validar la entrada en a.js:3', reviewer };
  const APPROVED = { verdict: 'APPROVE', notes: 'VEREDICTO: APPROVE', reviewer };

  const run = async (taskId, prompt = 'arreglá algo') => {
    const repo = makeRepo();
    await service.runProtected({ taskId, projectDir: repo.dir, prompt, provider: 'claude', model: 'sonnet' });
    return { ...repo, task: await service.getTask(taskId) };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    reviewWorktree.mockReset();
    runRetry.mockReset();
    runInitial.mockImplementation(async (args) => commitInWorktree(args));
    runRetry.mockImplementation(async () => ({ sessionId: 'sesion-1' }));
  });

  it('devuelve los motivos al desarrollador en el mismo worktree y publica si luego aprueba', async () => {
    reviewWorktree.mockResolvedValueOnce(REJECTED).mockResolvedValueOnce(APPROVED);
    runRetry.mockImplementationOnce(async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, 'correccion.txt'), 'ok');
      git(worktreePath, 'add', '-A');
      git(worktreePath, 'commit', '-m', 'correccion');
      return { sessionId: 'sesion-1' };
    });

    const { task, bare } = await run('rechazo-corregido');

    expect(runRetry).toHaveBeenCalledOnce();
    expect(runRetry).toHaveBeenCalledWith(expect.objectContaining({ worktreePath: task.worktreePath, reviewNotes: REJECTED.notes }));
    expect(reviewWorktree.mock.calls.map(([path]) => path)).toEqual([task.worktreePath, task.worktreePath]);
    expect(task.status).toBe('pr-open');
    expect(git(bare, 'ls-tree', '--name-only', 'claude/rechazo-corregido')).toContain('correccion.txt');
  });

  it('tras 2 correcciones fallidas no publica y Violet informa el motivo', async () => {
    reviewWorktree.mockResolvedValue(REJECTED);

    const { task, bare } = await run('rechazo-final');

    expect(runRetry).toHaveBeenCalledTimes(2);
    expect(reviewWorktree).toHaveBeenCalledTimes(3);
    expect(task.status).toBe('escalated-rejected');
    expect(createPr).not.toHaveBeenCalled();
    expect(git(bare, 'branch', '--list', 'claude/rechazo-final')).toBe('');

    const messages = [];
    violetService.once('message', (m) => messages.push(m.text));
    await violetService.onSupervisedStatusChange(task);
    expect(messages[0]).toContain('Falta validar la entrada en a.js:3');
    expect(messages[0]).toContain('Intentos de corrección: 2');
  });

  it('una corrección sin commitear se publica, en vez de la versión rechazada', async () => {
    reviewWorktree.mockResolvedValueOnce(REJECTED).mockResolvedValueOnce(APPROVED);
    runRetry.mockImplementationOnce(async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, 'correccion.txt'), 'ok');
      return { sessionId: 'sesion-1' };
    });

    const { bare } = await run('sin-commitear');

    expect(git(bare, 'ls-tree', '--name-only', 'claude/sin-commitear')).toContain('correccion.txt');
  });

  it('una primera pasada sin commitear no se pierde como "sin cambios"', async () => {
    reviewWorktree.mockResolvedValue(APPROVED);
    runInitial.mockImplementationOnce(async ({ worktreePath }) => {
      writeFileSync(join(worktreePath, 'trabajo.txt'), 'hecho');
      return { sessionId: 'sesion-1' };
    });

    const { task, bare } = await run('inicial-sin-commitear');

    expect(task.status).toBe('pr-open');
    expect(git(bare, 'ls-tree', '--name-only', 'claude/inicial-sin-commitear')).toContain('trabajo.txt');
  });

  it('respeta la prohibición de push al aprobar, y solo publica si el Jefe lo pide', async () => {
    reviewWorktree.mockResolvedValue(APPROVED);

    const { task, bare } = await run('sin-push', 'arreglá algo. No hagas push, no abras PR ni despliegues.');

    expect(createPr).not.toHaveBeenCalled();
    expect(git(bare, 'branch', '--list', 'claude/sin-push')).toBe('');
    expect(task.status).toBe('approved-unpublished');
    expect(task.lastError).toBeNull();

    await service.publishPR('sin-push');
    expect(createPr).toHaveBeenCalledOnce();
  });

  it('si el revisor no pudo evaluar no le pide correcciones al agente', async () => {
    reviewWorktree.mockResolvedValue({ verdict: 'ERROR', notes: 'No se pudo revisar con Codex: límite de uso', reviewer });

    const { task } = await run('revisor-caido');

    expect(runRetry).not.toHaveBeenCalled();
    expect(task.status).toBe('error');
    expect(task.lastError).toContain('límite de uso');
  });

  it.each([
    ['VEREDICTO: REJECT\nFalta validar', 'REJECT'],
    ['Analicé el diff.\n\n**VEREDICTO:** APPROVE', 'APPROVE'],
    ['VEREDICTO: FIX-NEEDED', 'FIX-NEEDED'],
    ['No puedo dar APPROVE todavía', 'FIX-NEEDED'],
    ['(sin respuesta)', 'FIX-NEEDED'],
  ])('interpreta el veredicto de %j como %s', (reply, expected) => {
    expect(parseReviewVerdict(reply)).toBe(expected);
  });

  it.each([
    ['No hagas push ni despliegues.', true],
    ['No despliegues, no hagas push, no cambies credenciales', true],
    ['no instales nada ni hagas commit, push o despliegue', true],
    ['No modifiques otros módulos, no hagas push, no abras PR ni despliegues.', true],
    ['Corregilo sin abrir un pull request', true],
    ['No publiques nada todavía', true],
    ['Do not push this', true],
    ['Corregí el bug y abrí un PR', false],
    ['No toques el header. Después hacé push', false],
    ['Arreglá el botón de publicar', false],
  ])('detecta restricción de push en %j: %s', (prompt, expected) => {
    expect(forbidsPublishing(prompt)).toBe(expected);
  });
});

describe('estado visible del agente supervisado', () => {
  const manager = new AgentManager();

  it.each([
    ['codex', undefined, 'gpt-6.1-sol'],
    ['codex', 'sonnet', 'gpt-6.1-sol'],
    ['codex', 'gpt-6-sol', 'gpt-6-sol'],
    ['claude', 'sonnet', 'sonnet'],
  ])('%s con modelo %s corre con %s', (provider, model, expected) => {
    const runProtected = vi.spyOn(service, 'runProtected').mockResolvedValue();

    manager.spawn({ prompt: 'arreglá algo', projectDir: 'x', provider, model });

    expect(runProtected).toHaveBeenCalledWith(expect.objectContaining({ model: expected }));
    runProtected.mockRestore();
  });

  it.each([
    ['reviewing', 'active'],
    ['retrying', 'active'],
    ['no-changes', 'completed'],
    ['approved-unpublished', 'completed'],
    ['pr-open', 'completed'],
    ['merged', 'completed'],
    ['escalated-rejected', 'stopped'],
    ['escalated-unresolved', 'stopped'],
    ['publish-error', 'stopped'],
    ['error', 'stopped'],
  ])('%s se muestra como %s', (taskStatus, agentStatus) => {
    manager.agents.set('t', { id: 't', status: 'spawning', logs: [] });

    service.emit('statusChange', { taskId: 't', status: taskStatus });

    expect(manager.get('t').status).toBe(agentStatus);
  });
});

describe('Violet launch_agent', () => {
  const spawn = vi.fn(() => ({ id: 'agent-x' }));

  beforeEach(() => {
    vi.clearAllMocks();
    violetService.setAgentManager({ on: vi.fn(), spawn });
  });

  it('usa la ruta explícita sin pasar por el clon detectado', async () => {
    const { dir } = makeRepo();

    await violetService._launchAgent({ repo: 'repo', dir, provider: 'claude', prompt: 'hacé algo' });

    expect(listRepos).not.toHaveBeenCalled();
    expect(resolve(spawn.mock.calls[0][0].projectDir).toLowerCase()).toBe(resolve(dir).toLowerCase());
  });

  it('no duplica el aviso de una tarea supervisada', async () => {
    const { dir } = makeRepo();
    spawn.mockReturnValueOnce({ id: 'agent-supervisado', supervised: true });

    await violetService._launchAgent({ dir, prompt: 'hacé algo' });

    expect(violetService.watchedAgents.has('agent-supervisado')).toBe(false);
  });

  it('rechaza una ruta que no es un repo git', async () => {
    await expect(violetService._launchAgent({ dir: join(sandbox, 'no-existe'), prompt: 'hacé algo' }))
      .rejects.toThrow(/no es un repositorio git/);
    expect(spawn).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { createWorktree, reviewWorktree } from './gitSupervision.js';
import { createPr } from './prService.js';
import { runInitial } from './providers/supervisionDrivers/claudeDriver.js';
import { supervisedAgentService as service } from './supervisedAgentService.js';
import { violetService } from './violetService.js';
import { listRepos } from './githubService.js';

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

  it('rechaza una ruta que no es un repo git', async () => {
    await expect(violetService._launchAgent({ dir: join(sandbox, 'no-existe'), prompt: 'hacé algo' }))
      .rejects.toThrow(/no es un repositorio git/);
    expect(spawn).not.toHaveBeenCalled();
  });
});

// Orquestador del pipeline supervisado: worktree aislado -> agente trabaja
// -> revisor Claude Code evalúa -> hasta 2 reintentos automáticos de
// corrección -> si aprueba, se publica un PR real en GitHub. El merge a la
// rama base NUNCA es automático — es siempre una acción explícita del
// usuario desde la UI (ver mergePR, el único punto de entrada a un merge).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from '../utils/logger.js';
import { PATHS } from '../utils/paths.js';
import { createWorktree, removeWorktree, reviewWorktree, getDiffStat, getCommits, getHeadSha, pushBranch } from './gitSupervision.js';
import { findExistingPr, createPr, mergePr } from './prService.js';
import { listRepos } from './githubService.js';
import * as claudeDriver from './providers/supervisionDrivers/claudeDriver.js';
import * as codexDriver from './providers/supervisionDrivers/codexDriver.js';
import * as ollamaDriver from './providers/supervisionDrivers/ollamaDriver.js';

const log = createLogger('SupervisedAgent');

const TASKS_FILE = join(PATHS.claudeDir, '..', 'command-center-data', 'supervised-tasks.json');
const MAX_RETRIES = 2;

const DRIVERS = { claude: claudeDriver, codex: codexDriver, ollama: ollamaDriver };

class SupervisedAgentService extends EventEmitter {
  async listTasks({ project, provider, status, since } = {}) {
    const all = await this._loadAll();
    let tasks = Object.values(all);
    if (project) tasks = tasks.filter((t) => t.repoFullName === project);
    if (provider) tasks = tasks.filter((t) => t.provider === provider);
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (since) tasks = tasks.filter((t) => new Date(t.startedAt) >= new Date(since));
    return tasks.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  async getTask(taskId) {
    const all = await this._loadAll();
    return all[taskId] || null;
  }

  async _loadAll() {
    try {
      const raw = await readFile(TASKS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  async _saveTask(task) {
    const all = await this._loadAll();
    all[task.taskId] = task;
    await mkdir(dirname(TASKS_FILE), { recursive: true });
    await writeFile(TASKS_FILE, JSON.stringify(all, null, 2));
  }

  async _emitStatus(task, status) {
    task.status = status;
    await this._saveTask(task);
    this.emit('statusChange', task);
  }

  /**
   * Corre el pipeline completo para una tarea. Fire-and-forget — el
   * progreso se sigue vía eventos y el registro persistido.
   */
  async runProtected({ taskId, projectDir, prompt, provider, model, effort, repoFullName }) {
    const driver = DRIVERS[provider];
    if (!driver) {
      log.error(`Proveedor desconocido para pipeline supervisado: ${provider}`);
      return;
    }

    const task = {
      taskId, projectDir, repoFullName, provider, model, effort,
      prompt, worktreePath: null, branch: null, baseBranch: null,
      status: 'working',
      driverState: { sessionId: null },
      reviewCycles: [],
      approvedSha: null,
      pr: null,
      mergeRecord: null,
      lastError: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    await this._saveTask(task);

    try {
      const { worktreePath, branch } = await createWorktree(projectDir, taskId, provider);
      task.worktreePath = worktreePath;
      task.branch = branch;
      await this._saveTask(task);
      this.emit('started', { taskId, projectDir, worktreePath, branch, prompt, provider, model, startedAt: task.startedAt });

      const baseBranch = await this._resolveBaseBranch(repoFullName);
      if (!baseBranch) {
        task.lastError = `No se pudo determinar la rama base de "${repoFullName}" con confianza`;
        await this._emitStatus(task, 'publish-error');
        return;
      }
      task.baseBranch = baseBranch;
      await this._saveTask(task);

      const initial = await driver.runInitial({ taskId, worktreePath, prompt, model, effort });
      task.driverState.sessionId = initial.sessionId;
      await this._saveTask(task);

      const diff = await getDiffStat(worktreePath, baseBranch);
      if (!diff) {
        await this._emitStatus(task, 'no-changes');
        log.info(`Tarea ${taskId}: sin cambios, no hace falta revisión ni PR`);
        return;
      }

      await this._runReviewCycle(task, driver);
    } catch (err) {
      log.error(`Error en tarea supervisada ${taskId}: ${err.message}`);
      task.lastError = err.message;
      await this._emitStatus(task, 'error');
    }
  }

  async _runReviewCycle(task, driver) {
    let attempt = 0;

    while (true) {
      await this._emitStatus(task, 'reviewing');
      const { verdict, notes } = await reviewWorktree(task.worktreePath);
      const reviewedSha = await getHeadSha(task.worktreePath);

      task.reviewCycles.push({ attempt, verdict, notes, reviewedSha, timestamp: new Date().toISOString() });
      await this._saveTask(task);
      this.emit('reviewResult', { taskId: task.taskId, attempt, verdict, notes, reviewedSha, timestamp: new Date().toISOString() });

      if (verdict === 'APPROVE') {
        task.approvedSha = reviewedSha;
        await this._saveTask(task);
        await this.publishPR(task.taskId);
        return;
      }

      if (verdict === 'REJECT') {
        await this._emitStatus(task, 'escalated-rejected');
        log.info(`Tarea ${task.taskId} rechazada por el revisor (problema grave) — sin reintento`);
        return;
      }

      // FIX-NEEDED
      if (attempt >= MAX_RETRIES) {
        await this._emitStatus(task, 'escalated-unresolved');
        log.info(`Tarea ${task.taskId} agotó los reintentos de corrección`);
        return;
      }

      attempt++;
      await this._emitStatus(task, 'retrying');
      const retry = await driver.runRetry({
        taskId: task.taskId,
        worktreePath: task.worktreePath,
        sessionId: task.driverState.sessionId,
        reviewNotes: notes,
        model: task.model,
        effort: task.effort,
      });
      task.driverState.sessionId = retry.sessionId || task.driverState.sessionId;
      await this._saveTask(task);
    }
  }

  async _resolveBaseBranch(repoFullName) {
    if (!repoFullName) return null;
    try {
      const repos = await listRepos();
      const repo = repos.find((r) => r.fullName === repoFullName);
      return repo?.defaultBranch || null;
    } catch (err) {
      log.error(`Error resolviendo rama base: ${err.message}`);
      return null;
    }
  }

  /**
   * Publica la rama (push) y abre un PR real. Idempotente: si ya existe un
   * PR para esta rama, solo lo registra en vez de crear uno nuevo.
   */
  async publishPR(taskId) {
    const task = await this.getTask(taskId);
    if (!task) return;

    try {
      const existing = await findExistingPr(task.worktreePath, task.branch);
      let pr;

      if (existing) {
        pr = existing;
        log.info(`PR existente encontrado para ${task.branch}: #${existing.number}`);
      } else {
        await pushBranch(task.worktreePath, task.branch);
        const commits = await getCommits(task.worktreePath, task.baseBranch);
        const title = task.prompt.slice(0, 72);
        const body = `Agente: ${task.provider} (${task.model})\n\nTarea:\n${task.prompt}\n\nCommits:\n${commits.map((c) => `- ${c.subject}`).join('\n')}\n\n---\nCreado automáticamente por Command Center. Revisado por un agente Claude Code de solo lectura antes de publicarse. El merge queda pendiente de aprobación manual.`;
        pr = await createPr({ worktreePath: task.worktreePath, branch: task.branch, baseBranch: task.baseBranch, title, body });
      }

      const headSha = await getHeadSha(task.worktreePath);
      task.pr = { number: pr.number, url: pr.url, headSha, baseBranch: task.baseBranch };
      task.approvedSha = headSha;
      await this._emitStatus(task, 'pr-open');
      this.emit('prCreated', { taskId, number: pr.number, url: pr.url, baseBranch: task.baseBranch, headSha, timestamp: new Date().toISOString() });
    } catch (err) {
      log.error(`Error publicando PR para ${taskId}: ${err.message}`);
      task.lastError = err.message;
      await this._emitStatus(task, 'publish-error');
      this.emit('publishError', { taskId, message: err.message, timestamp: new Date().toISOString() });
    }
  }

  /**
   * ÚNICO punto de entrada a un merge real en todo el sistema. Solo debe
   * ser invocado desde la ruta REST POST /api/v1/supervised-tasks/:id/merge,
   * disparada por el botón "Aprobar e integrar" del frontend — ningún tool
   * de Violet, ningún agente, ningún flujo automático llama esta función.
   */
  async mergePR(taskId) {
    const task = await this.getTask(taskId);
    if (!task) throw new Error('Tarea no encontrada');
    if (!task.pr) throw new Error('Esta tarea no tiene un PR abierto');

    const currentSha = await getHeadSha(task.worktreePath);
    if (currentSha !== task.approvedSha) {
      task.status = 'reviewing-required';
      await this._saveTask(task);
      const err = new Error('stale-approval');
      err.code = 'stale-approval';
      throw err;
    }

    await mergePr({ worktreePath: task.worktreePath, prNumber: task.pr.number });

    task.mergeRecord = {
      approvedBy: 'user',
      mergedAt: new Date().toISOString(),
      mergedSha: currentSha,
      prNumber: task.pr.number,
    };
    await this._emitStatus(task, 'merged');
    this.emit('merged', { taskId, prNumber: task.pr.number, mergedSha: currentSha, approvedBy: 'user', timestamp: new Date().toISOString() });
    return task;
  }
}

export const supervisedAgentService = new SupervisedAgentService();

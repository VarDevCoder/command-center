import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { violetService } from './violetService.js';
import { supervisedAgentService } from './supervisedAgentService.js';
import { handleOutput } from './providers/claudeProvider.js';

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'cc-violet-'));
  return { ...actual, PATHS: { ...actual.PATHS, claudeDir: join(home, '.claude') } };
});

afterAll(() => rmSync(dirname(PATHS.claudeDir), { recursive: true, force: true }));

const DONE = {
  id: 'agent-1', provider: 'claude', model: 'sonnet', projectDir: 'C:\\Dev\\Solunet', status: 'completed',
  prompt: 'Revisá los tests', startedAt: '2026-11-13T10:00:00.000Z', sessionId: 'sesion-1', result: 'Pasan los 12 tests.', logs: [],
};
const TASK = {
  taskId: 'agent-9', provider: 'codex', repoFullName: 'VarDevCoder/Portfolio', projectDir: 'C:\\Dev\\Portfolio', status: 'pr-open',
  prompt: 'Corregí el header', startedAt: '2026-11-13T09:00:00.000Z', branch: 'codex/agent-9', pr: { url: 'https://github.com/x/y/pull/1' },
  reviewCycles: [{ verdict: 'APPROVE', notes: 'Todo bien' }], lastReply: 'Header corregido.',
};

let manager;
let codex;

beforeEach(() => {
  vi.restoreAllMocks();
  manager = {
    on: vi.fn(),
    getAll: vi.fn(() => [DONE]),
    get: vi.fn((id) => (id === DONE.id ? DONE : null)),
    spawn: vi.fn(() => ({ id: 'agent-2' })),
    stop: vi.fn(async () => true),
  };
  violetService.setAgentManager(manager);
  violetService.busy = false;
  violetService.pendingNotices = [];
  violetService.watchedAgents.clear();
  codex = vi.spyOn(violetService, '_runCodex');
  vi.spyOn(supervisedAgentService, 'listTasks').mockResolvedValue([TASK]);
  vi.spyOn(supervisedAgentService, 'getTask').mockImplementation(async (id) => (id === TASK.taskId ? TASK : null));
});

const call = (toolCall) => violetService._executeTool(toolCall);

describe('Violet ve a sus agentes', () => {
  it('lista juntos los agentes en memoria y las tareas guardadas, lo más nuevo primero', async () => {
    const lines = (await call({ tool: 'list_agents' })).split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^agent-1 \| claude \| Solunet \| terminó/);
    expect(lines[1]).toMatch(/^agent-9 \| codex \| VarDevCoder\/Portfolio \| PR abierto/);
  });

  it('lee el resultado de un agente directo y el de una tarea supervisada', async () => {
    expect(await call({ tool: 'agent_result', id: 'agent-1' })).toContain('Pasan los 12 tests.');

    const task = await call({ tool: 'agent_result', id: 'agent-9' });
    expect(task).toContain('https://github.com/x/y/pull/1');
    expect(task).toContain('Header corregido.');
    expect(task).toContain('APPROVE');
  });

  it('avisa si el id no existe, en vez de inventar un estado', async () => {
    expect(await call({ tool: 'agent_result', id: 'agent-404' })).toMatch(/no existe ningún agente/);
  });
});

describe('Violet le habla a un agente o lo detiene', () => {
  it('retoma la misma conversación y queda atenta al resultado', async () => {
    const reply = await call({ tool: 'message_agent', id: 'agent-1', prompt: '¿Y la cobertura?' });

    expect(manager.spawn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '¿Y la cobertura?', projectDir: DONE.projectDir, provider: 'claude', resumeFrom: 'sesion-1',
    }));
    expect(reply).toContain('agent-2');
    expect(violetService.watchedAgents.has('agent-2')).toBe(true);
  });

  it.each([
    ['sigue trabajando', { status: 'active' }, /todavía está trabajando/],
    ['no dejó conversación', { sessionId: null }, /no dejó una conversación/],
  ])('no manda el mensaje si el agente %s', async (_, patch, expected) => {
    manager.get.mockReturnValue({ ...DONE, ...patch });

    expect(await call({ tool: 'message_agent', id: 'agent-1', prompt: 'seguí' })).toMatch(expected);
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it('a una tarea en rama protegida la retoma en su misma rama', async () => {
    const resume = vi.spyOn(supervisedAgentService, 'continueTask').mockResolvedValue(null);

    expect(await call({ tool: 'message_agent', id: 'agent-9', prompt: 'corregí lo que falta' })).toMatch(/misma rama protegida/);
    expect(resume).toHaveBeenCalledWith('agent-9', 'corregí lo que falta');
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it('si la tarea ya tiene PR, no la retoma y dice por qué', async () => {
    expect(await call({ tool: 'message_agent', id: 'agent-9', prompt: 'seguí' })).toMatch(/ya tiene un PR/);
  });

  it('detiene un agente en memoria', async () => {
    expect(await call({ tool: 'stop_agent', id: 'agent-1' })).toBe('Agente agent-1 detenido.');
    expect(manager.stop).toHaveBeenCalledWith('agent-1');
  });
});

describe('avisos de agentes', () => {
  const lastMessage = () => violetService.messages.at(-1).text;

  it('los redacta el modelo cuando Violet está libre', async () => {
    codex.mockResolvedValue('Jefe, los tests pasan. ¿Sigo con el deploy?');

    await violetService._report('el agente terminó');

    expect(codex.mock.calls[0][0]).toContain('el agente terminó');
    expect(lastMessage()).toBe('Jefe, los tests pasan. ¿Sigo con el deploy?');
    expect(violetService.busy).toBe(false);
  });

  it('un aviso no dispara herramientas solo: si el modelo pide una, sale el texto del sistema', async () => {
    codex.mockResolvedValue('```json\n{"tool":"launch_agent","repo":"x","prompt":"seguí"}\n```');

    await violetService._report('el agente terminó');

    expect(lastMessage()).toBe('el agente terminó');
    expect(manager.spawn).not.toHaveBeenCalled();
  });

  it('si Codex falla sale igual, y el modelo lo lee en su próximo turno', async () => {
    codex.mockRejectedValueOnce(new Error('usage limit'));
    await violetService._report('el agente falló');
    expect(lastMessage()).toBe('el agente falló');

    codex.mockResolvedValue('Enterada, Jefe.');
    await violetService.send('¿qué pasó?');

    expect(codex.mock.calls.at(-1)[0]).toContain('- el agente falló');
    expect(violetService.pendingNotices).toEqual([]);
  });

  it('si Violet está ocupada no la interrumpe', async () => {
    violetService.busy = true;

    await violetService._report('el agente terminó');

    expect(codex).not.toHaveBeenCalled();
    expect(violetService.pendingNotices).toEqual(['el agente terminó']);
  });

  it('una tarea que termina sin cambios también se avisa, con la respuesta del agente', async () => {
    codex.mockRejectedValue(new Error('sin codex'));

    await violetService.onSupervisedStatusChange({ ...TASK, status: 'no-changes' });

    expect(lastMessage()).toContain('terminó sin modificar archivos');
    expect(lastMessage()).toContain('Header corregido.');
  });
});

describe('consultas de varios pasos', () => {
  const TOOL = '```json\n{"tool":"list_agents"}\n```';

  it('en el último paso se le pide responder, y responde', async () => {
    for (let i = 0; i < 11; i++) codex.mockResolvedValueOnce(TOOL);
    codex.mockResolvedValueOnce('Esto es lo que encontré, Jefe.');

    const reply = await violetService.send('revisá todo');

    expect(codex).toHaveBeenCalledTimes(12);
    expect(codex.mock.calls[10][0]).not.toContain('Ya no podés usar más herramientas');
    expect(codex.mock.calls[11][0]).toContain('Ya no podés usar más herramientas');
    expect(reply.text).toBe('Esto es lo que encontré, Jefe.');
  });
});

describe('salida de un agente Claude', () => {
  it('guarda la sesión, el resultado y el consumo, y registra texto y herramientas', () => {
    const agent = { sessionId: null, result: null, tokensIn: 0, tokensOut: 0 };
    const logs = [];
    const fake = { agents: new Map([['a', agent]]), addLog: (_, entry) => logs.push(entry) };
    const feed = (event) => handleOutput(fake, 'a', JSON.stringify(event));

    feed({ type: 'system', subtype: 'init', session_id: 'sesion-7' });
    feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reviso los tests.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } });
    feed({ type: 'result', result: 'Pasan todos.', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 7 } });
    handleOutput(fake, 'a', 'texto suelto');

    expect(agent).toMatchObject({ sessionId: 'sesion-7', result: 'Pasan todos.', tokensIn: 100, tokensOut: 7 });
    expect(logs.map((entry) => [entry.type, entry.toolName ?? entry.content])).toEqual([
      ['assistant', 'Reviso los tests.'],
      ['tool_use', 'Bash'],
      ['output', 'texto suelto'],
    ]);
  });
});

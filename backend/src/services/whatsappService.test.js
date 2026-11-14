import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from '../utils/paths.js';
import { violetService } from './violetService.js';
import { WhatsAppService } from './whatsappService.js';
import { VIOLET_MARKER, ownChatJids, phoneFromJid, splitMessage } from './whatsappPolicy.js';

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'cc-whatsapp-'));
  return { ...actual, PATHS: { ...actual.PATHS, claudeDir: join(home, '.claude') } };
});

afterAll(() => rmSync(dirname(PATHS.claudeDir), { recursive: true, force: true }));

const OWN_JID = '595981000001@s.whatsapp.net';
const OWN_LID_JID = '111222333@lid';
const USER = { id: '595981000001:7@s.whatsapp.net', lid: '111222333:7@lid' };
const FRIEND_JID = '595981999999@s.whatsapp.net';
const FRIEND_LID_JID = '777888999@lid';

let counter = 0;
const own = ({ text = 'hola', key = {}, timestamp = Date.now() / 1000, message } = {}) => ({
  key: { id: `id-${++counter}`, remoteJid: OWN_JID, fromMe: true, ...key },
  messageTimestamp: timestamp,
  message: message === undefined ? { conversation: text } : message,
});

async function startService({ user = USER } = {}) {
  const violet = Object.assign(new EventEmitter(), {
    send: vi.fn(async () => {}),
    confirmPendingAction: vi.fn(async () => 'confirmado'),
    cancelPendingAction: vi.fn(() => 'cancelado'),
    hasPendingAction: vi.fn(() => false),
  });
  const agentManager = { getAll: vi.fn(() => []), stop: vi.fn(async () => false) };
  const socket = { user, sendMessage: vi.fn(async () => {}) };
  let handlers;
  const service = new WhatsAppService({
    connect: vi.fn(async (received) => { handlers = received; return socket; }),
    linked: async () => true,
    normalize: async (content) => content,
  });
  await service.start({ violet, agentManager });
  handlers.onConnectionUpdate({ connection: 'open' }, socket);
  const deliver = (...messages) => handlers.onMessages({ type: 'notify', messages });
  return { service, violet, agentManager, socket, handlers, deliver };
}

const sent = (text) => ({ text: `${VIOLET_MARKER}\n${text}` });

describe('qué le llega a Violet', () => {
  it.each([
    ['con tu número', OWN_JID],
    ['con tu LID', OWN_LID_JID],
  ])('atiende tu chat contigo mismo %s, y responde ahí', async (_, remoteJid) => {
    const { violet, deliver, socket } = await startService();

    await deliver(own({ text: 'hola Violet', key: { remoteJid } }));
    expect(violet.send).toHaveBeenCalledWith('hola Violet', [], 'whatsapp');

    violet.emit('message', { role: 'violet', text: 'hola Jefe', channel: 'whatsapp' });
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalledWith(remoteJid, sent('hola Jefe')));
  });

  it.each([
    ['lo que te manda un amigo', { key: { remoteJid: FRIEND_JID, fromMe: false } }],
    ['lo que le mandás a un amigo', { key: { remoteJid: FRIEND_JID } }],
    ['lo que le mandás a un amigo por LID, con tu número como dato alternativo', { key: { remoteJid: FRIEND_LID_JID, remoteJidAlt: OWN_JID } }],
    ['un amigo cuyo dato alternativo dice ser vos', { key: { remoteJid: FRIEND_LID_JID, remoteJidAlt: OWN_JID, fromMe: false } }],
    ['tu chat, si el mensaje no es tuyo', { key: { fromMe: false } }],
    ['tu chat, sin dato de autor', { key: { fromMe: undefined } }],
    ['lo que escribís en un grupo', { key: { remoteJid: '12345@g.us', participant: OWN_JID } }],
    ['tus estados', { key: { remoteJid: 'status@broadcast', participant: OWN_JID } }],
    ['una lista de difusión', { key: { remoteJid: '123@broadcast', participant: OWN_JID } }],
    ['otro dispositivo tuyo como chat', { key: { remoteJid: '595981000001:9@s.whatsapp.net' } }],
    ['un número que solo se parece al tuyo', { key: { remoteJid: '5959810000012@s.whatsapp.net' } }],
    ['una orden vieja', { timestamp: Date.now() / 1000 - 301 }],
    ['un mensaje sin fecha', { timestamp: undefined }],
  ])('ignora en silencio: %s', async (_, overrides) => {
    const { violet, deliver, socket } = await startService();

    const message = own(overrides);
    if ('timestamp' in overrides) message.messageTimestamp = overrides.timestamp;
    await deliver(message);

    expect(violet.send).not.toHaveBeenCalled();
    expect(socket.sendMessage).not.toHaveBeenCalled();
  });

  it('ignora tu LID si la sesión no lo conoce, en vez de adivinar', async () => {
    const { violet, deliver } = await startService({ user: { id: USER.id } });

    await deliver(own({ key: { remoteJid: OWN_LID_JID } }));

    expect(violet.send).not.toHaveBeenCalled();
  });

  it('no atiende nada antes de conectarse', async () => {
    const violet = Object.assign(new EventEmitter(), { send: vi.fn() });
    const service = new WhatsAppService({ connect: vi.fn(async () => ({})), linked: async () => true, normalize: async (c) => c });
    await service.start({ violet, agentManager: {} });

    await service._onMessages({ type: 'notify', messages: [own()] });

    expect(violet.send).not.toHaveBeenCalled();
  });

  it('no procesa dos veces el mismo mensaje ni los que no son nuevos', async () => {
    const { violet, deliver, handlers } = await startService();
    const message = own();

    await deliver(message);
    await deliver(message);
    await handlers.onMessages({ type: 'append', messages: [own()] });

    expect(violet.send).toHaveBeenCalledOnce();
  });

  it('avisa si mandás una imagen, pero calla ante avisos internos de sincronización', async () => {
    const { violet, deliver, socket } = await startService();

    await deliver(own({ message: { protocolMessage: { type: 3 } } }), own({ message: null }));
    expect(socket.sendMessage).not.toHaveBeenCalled();

    await deliver(own({ message: { imageMessage: {} } }));
    expect(violet.send).not.toHaveBeenCalled();
    expect(socket.sendMessage).toHaveBeenCalledWith(OWN_JID, sent('Por ahora solo leo mensajes de texto.'));
  });
});

describe('Violet no se responde a sí misma', () => {
  it('cada parte de lo que envía lleva la marca, y al volver se descarta', async () => {
    const { violet, deliver, socket } = await startService();

    violet.emit('message', { role: 'violet', text: `${'a'.repeat(3000)}\n${'b'.repeat(3000)}` });
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalledTimes(2));

    for (const [, { text }] of socket.sendMessage.mock.calls) {
      expect(text.startsWith(VIOLET_MARKER)).toBe(true);
      await deliver(own({ text }));
    }
    expect(violet.send).not.toHaveBeenCalled();
  });

  it('reconoce lo que envió por su ID, aunque vuelva sin la marca', async () => {
    const { violet, deliver, socket } = await startService();
    socket.sendMessage.mockResolvedValue({ key: { id: 'enviado-por-violet' } });

    violet.emit('message', { role: 'violet', text: 'hola Jefe' });
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalled());
    await deliver(own({ text: 'hola Jefe', key: { id: 'enviado-por-violet' } }));

    expect(violet.send).not.toHaveBeenCalled();
  });

  it('una respuesta del modelo no puede autoconfirmar una acción', async () => {
    const { violet, deliver, socket } = await startService();

    violet.hasPendingAction.mockReturnValue(true);
    socket.sendMessage.mockResolvedValue({ key: { id: 'enviado' } });

    violet.emit('message', { role: 'violet', text: 'Sí' });
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalled());
    await deliver(own({ text: socket.sendMessage.mock.calls[0][1].text }));
    await deliver(own({ text: 'Sí', key: { id: 'enviado' } }));

    expect(violet.confirmPendingAction).not.toHaveBeenCalled();
    expect(violet.cancelPendingAction).not.toHaveBeenCalled();
  });

  it('el pedido de confirmación tampoco vuelve como orden', async () => {
    const { violet, deliver, socket } = await startService();
    violet.hasPendingAction.mockReturnValue(true);

    violet.emit('confirmationRequired', { summary: 'launch_agent' });
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalled());
    await deliver(own({ text: socket.sendMessage.mock.calls[0][1].text }));

    expect(violet.send).not.toHaveBeenCalled();
    expect(violet.confirmPendingAction).not.toHaveBeenCalled();
  });
});

describe('qué se envía al celular', () => {
  it('manda respuestas de WhatsApp y avisos, pero no el chat de la web', async () => {
    const { violet, socket } = await startService();

    violet.emit('message', { role: 'violet', text: 'de la web', channel: 'web' });
    violet.emit('message', { role: 'user', text: 'mensaje del Jefe', channel: 'whatsapp' });
    violet.emit('message', { role: 'violet', text: 'hay un PR listo' });

    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalledOnce());
    expect(socket.sendMessage).toHaveBeenCalledWith(OWN_JID, sent('hay un PR listo'));
  });

  it('guarda lo que no pudo enviar y lo manda al reconectar', async () => {
    const { violet, handlers, socket } = await startService();

    handlers.onConnectionUpdate({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 500 } } } }, socket);
    violet.emit('message', { role: 'violet', text: 'aviso pendiente' });
    expect(socket.sendMessage).not.toHaveBeenCalled();

    handlers.onConnectionUpdate({ connection: 'open' }, socket);
    await vi.waitFor(() => expect(socket.sendMessage).toHaveBeenCalledWith(OWN_JID, sent('aviso pendiente')));
  });

  it('no reintenta si cerraste la sesión desde el celular', async () => {
    vi.useFakeTimers();
    const { service, handlers, socket } = await startService();

    handlers.onConnectionUpdate({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }, socket);
    await vi.advanceTimersByTimeAsync(60000);

    expect(service.connect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('corta los textos largos', () => {
    const parts = splitMessage(`${'a'.repeat(3000)}\n${'b'.repeat(3000)}`);
    expect(parts).toHaveLength(2);
    expect(parts.join('\n')).toHaveLength(6001);
  });
});

describe('órdenes que resuelve el código', () => {
  it.each(['Si', 'sí', 'Sí.', 'dale'])('con una acción retenida, "%s" la autoriza sin pasar por el modelo', async (text) => {
    const { violet, deliver, socket } = await startService();
    violet.hasPendingAction.mockReturnValue(true);

    await deliver(own({ text }));

    expect(violet.send).not.toHaveBeenCalled();
    expect(violet.confirmPendingAction).toHaveBeenCalledOnce();
    expect(socket.sendMessage).toHaveBeenCalledWith(OWN_JID, sent('confirmado'));
  });

  it('con una acción retenida, "No" la descarta sin pasar por el modelo', async () => {
    const { violet, deliver, socket } = await startService();
    violet.hasPendingAction.mockReturnValue(true);

    await deliver(own({ text: 'No' }));

    expect(violet.send).not.toHaveBeenCalled();
    expect(violet.confirmPendingAction).not.toHaveBeenCalled();
    expect(socket.sendMessage).toHaveBeenCalledWith(OWN_JID, sent('cancelado'));
  });

  it('cualquier otro mensaje descarta la acción retenida y le llega a Violet', async () => {
    const { violet, deliver } = await startService();
    violet.hasPendingAction.mockReturnValue(true);

    await deliver(own({ text: 'si pero cambiá el repo' }));

    expect(violet.confirmPendingAction).not.toHaveBeenCalled();
    expect(violet.cancelPendingAction).toHaveBeenCalledOnce();
    expect(violet.send).toHaveBeenCalledWith('si pero cambiá el repo', [], 'whatsapp');
  });

  it('sin nada retenido, un "sí" es un mensaje común para Violet', async () => {
    const { violet, deliver } = await startService();

    await deliver(own({ text: 'Si' }));

    expect(violet.confirmPendingAction).not.toHaveBeenCalled();
    expect(violet.send).toHaveBeenCalledWith('Si', [], 'whatsapp');
  });

  it('/stop informa lo que no pudo detener', async () => {
    const { agentManager, deliver, socket, violet } = await startService();
    agentManager.getAll.mockReturnValue([{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }, { id: 'c', status: 'completed' }]);
    agentManager.stop.mockImplementation(async (id) => id === 'a');

    await deliver(own({ text: '/stop' }));

    expect(agentManager.stop).toHaveBeenCalledTimes(2);
    expect(violet.send).not.toHaveBeenCalled();
    expect(socket.sendMessage.mock.calls[0][1].text).toMatch(/Detuve 1 agente.*1 supervisado/);
  });
});

describe('acciones sensibles pedidas por WhatsApp', () => {
  const spawn = vi.fn(() => ({ id: 'agent-x' }));
  const LAUNCH = { tool: 'launch_agent', repo: 'obsidian', provider: 'claude', prompt: 'borrá todo' };

  beforeEach(() => {
    spawn.mockClear();
    violetService.pendingAction = null;
    violetService.removeAllListeners('confirmationRequired');
    violetService.setAgentManager({ on: vi.fn(), spawn });
  });

  const hold = async () => {
    const requests = [];
    violetService.on('confirmationRequired', (request) => requests.push(request));
    const result = await violetService._executeTool(LAUNCH, 'whatsapp');
    return { result, request: requests[0] };
  };

  it('quedan retenidas, y al Jefe le llega el pedido real', async () => {
    const { result, request } = await hold();

    expect(spawn).not.toHaveBeenCalled();
    expect(request.summary).toContain('borrá todo');
    expect(result).toMatch(/NO se ejecutó/);
    expect(violetService.hasPendingAction()).toBe(true);
  });

  it.each(['message_agent', 'stop_agent', 'open_vscode_project', 'stop_vscode_turn'])('%s también queda retenida', async (tool) => {
    const result = await violetService._executeTool({ tool, repo: 'x', uri: 'x' }, 'whatsapp');
    expect(result).toMatch(/NO se ejecutó/);
  });

  it('se ejecutan una sola vez al autorizarlas, y el modelo se entera por un aviso', async () => {
    await hold();
    violetService.pendingNotices = [];

    await violetService.confirmPendingAction();
    expect(spawn).toHaveBeenCalledOnce();
    expect(violetService.pendingNotices[0]).toMatch(/El Jefe autorizó launch_agent/);

    expect(await violetService.confirmPendingAction()).toMatch(/ninguna acción pendiente/);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('el pedido vence a los 5 minutos', async () => {
    await hold();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);

    expect(violetService.hasPendingAction()).toBe(false);
    expect(await violetService.confirmPendingAction()).toMatch(/ninguna acción pendiente/);
    expect(spawn).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('se puede cancelar', async () => {
    await hold();

    expect(violetService.cancelPendingAction()).toBe('Acción descartada.');
    expect(await violetService.confirmPendingAction()).toMatch(/ninguna acción pendiente/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('desde la web siguen funcionando sin código', async () => {
    await violetService._executeTool(LAUNCH);
    expect(spawn).toHaveBeenCalledOnce();
  });
});

describe('reglas del canal', () => {
  it('lee el número aunque tenga sufijo de dispositivo, y nada más', () => {
    expect(phoneFromJid('595981000001:12@s.whatsapp.net')).toBe('595981000001');
    expect(phoneFromJid('595981000001@g.us')).toBeNull();
    expect(phoneFromJid('595981000001@s.whatsapp.net.evil.com')).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
  });

  it('tu chat son tu número y tu LID, sin el dispositivo', () => {
    expect(ownChatJids(USER)).toEqual([OWN_JID, OWN_LID_JID]);
    expect(ownChatJids(null)).toEqual([]);
  });
});

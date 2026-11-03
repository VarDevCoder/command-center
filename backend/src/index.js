// Servidor principal: Express + Socket.IO — Command Center
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import sessionsRouter from './routes/sessions.js';
import projectsRouter from './routes/projects.js';
import agentsRouter, { setAgentManager } from './routes/agents.js';
import violetRouter from './routes/violet.js';
import chatsRouter from './routes/chats.js';
import supervisedTasksRouter from './routes/supervisedTasks.js';
import vscodeAgentsRouter from './routes/vscodeAgents.js';
import usageRouter from './routes/usage.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { SessionWatcher } from './services/sessionWatcher.js';
import { AgentManager } from './services/agentManager.js';
import { repoLocator } from './services/repoLocator.js';
import { violetService } from './services/violetService.js';
import { repoChatService } from './services/repoChatService.js';
import { ollamaAgentService } from './services/ollamaAgentService.js';
import { supervisedAgentService } from './services/supervisedAgentService.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');
const PORT = process.env.PORT || 3066;

// Express
const app = express();
app.use(cors({ origin: ['http://localhost:5166', 'http://localhost:5173'] }));
app.use(helmet({ contentSecurityPolicy: false }));
// Las imágenes de Violet viajan como base64. El límite sigue siendo acotado
// y cada archivo se vuelve a validar antes de guardarse.
app.use(express.json({ limit: '36mb' }));

// HTTP Server compartido
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5166', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

// Servicios
const sessionWatcher = new SessionWatcher();
const agentManager = new AgentManager();
setAgentManager(agentManager);
violetService.setAgentManager(agentManager);
supervisedAgentService.on('statusChange', (task) => violetService.onSupervisedStatusChange(task));

// Rutas REST
app.use('/api/v1/sessions', sessionsRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/violet', violetRouter);
app.use('/api/v1/chats', chatsRouter);
app.use('/api/v1/supervised-tasks', supervisedTasksRouter);
app.use('/api/v1/vscode-agents', vscodeAgentsRouter);
app.use('/api/v1/usage', usageRouter);

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      agents: agentManager.getAll().length,
    },
  });
});

// Error handler
app.use(errorHandler);

// === Socket.IO ===
io.on('connection', (socket) => {
  log.info(`Cliente conectado: ${socket.id}`);

  // Enviar listas al conectar
  socket.emit('agent:list', agentManager.getAll());

  // Suscribirse a logs de una sesión
  socket.on('subscribe:session', (sessionId) => {
    socket.join(`session:${sessionId}`);
    log.info(`${socket.id} suscrito a sesión ${sessionId}`);
  });

  socket.on('unsubscribe:session', (sessionId) => {
    socket.leave(`session:${sessionId}`);
  });

  socket.on('disconnect', () => {
    log.info(`Cliente desconectado: ${socket.id}`);
  });
});

// === Event wiring ===

// Session watcher -> Socket.IO
sessionWatcher.on('message', (sessionId, message) => {
  io.to(`session:${sessionId}`).emit('session:message', { sessionId, message });
  // También notificar a todos del activity
  io.emit('session:activity', { sessionId, timestamp: message.timestamp });
});

// Agent manager -> Socket.IO
agentManager.on('spawned', (agent) => {
  io.emit('agent:spawned', agent);
});

agentManager.on('statusChange', (agent) => {
  io.emit('agent:update', agent);
});

agentManager.on('log', (agentId, logEntry) => {
  io.emit('agent:log', { agentId, ...logEntry });
});

// Violet -> Socket.IO
violetService.on('message', (msg) => {
  io.emit('violet:message', msg);
});

violetService.on('toolCall', (payload) => {
  io.emit('violet:toolCall', payload);
});

// Repo chats -> Socket.IO
repoChatService.on('message', (msg) => {
  io.emit('chat:message', msg);
});

// Ollama agent -> Socket.IO (detalle turno-a-turno, específico de Ollama)
ollamaAgentService.on('turn', (payload) => io.emit('ollama:turn', payload));
ollamaAgentService.on('toolResult', (payload) => io.emit('ollama:toolResult', payload));

// Pipeline supervisado -> Socket.IO (worktree + revisor + PR, todos los proveedores)
supervisedAgentService.on('started', (payload) => io.emit('supervised:started', payload));
supervisedAgentService.on('statusChange', (payload) => io.emit('supervised:statusChange', payload));
supervisedAgentService.on('reviewResult', (payload) => io.emit('supervised:reviewResult', payload));
supervisedAgentService.on('prCreated', (payload) => io.emit('supervised:prCreated', payload));
supervisedAgentService.on('publishError', (payload) => io.emit('supervised:publishError', payload));
supervisedAgentService.on('merged', (payload) => io.emit('supervised:merged', payload));

// === Iniciar ===
sessionWatcher.start();
repoLocator.startScan();

httpServer.listen(PORT, () => {
  log.info(`Command Center backend en http://localhost:${PORT}`);
  log.info(`Socket.IO listo para conexiones`);
});

// Cleanup al cerrar
process.on('SIGINT', async () => {
  log.info('Cerrando...');
  await sessionWatcher.stop();
  httpServer.close();
  process.exit(0);
});

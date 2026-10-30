// Servidor principal: Express + Socket.IO — Command Center
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';

import sessionsRouter from './routes/sessions.js';
import projectsRouter from './routes/projects.js';
import agentsRouter, { setAgentManager } from './routes/agents.js';
import terminalsRouter, { setTerminalManager } from './routes/terminals.js';
import violetRouter from './routes/violet.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { SessionWatcher } from './services/sessionWatcher.js';
import { AgentManager } from './services/agentManager.js';
import { TerminalManager } from './services/terminalManager.js';
import { repoLocator } from './services/repoLocator.js';
import { violetService } from './services/violetService.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');
const PORT = process.env.PORT || 3066;

// Express
const app = express();
app.use(cors({ origin: ['http://localhost:5166', 'http://localhost:5173'] }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

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
const terminalManager = new TerminalManager();
setAgentManager(agentManager);
setTerminalManager(terminalManager);

// Rutas REST
app.use('/api/v1/sessions', sessionsRouter);
app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/terminals', terminalsRouter);
app.use('/api/v1/violet', violetRouter);

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
  socket.emit('terminal:list', terminalManager.getAll());

  // Suscribirse a logs de una sesión
  socket.on('subscribe:session', (sessionId) => {
    socket.join(`session:${sessionId}`);
    log.info(`${socket.id} suscrito a sesión ${sessionId}`);
  });

  socket.on('unsubscribe:session', (sessionId) => {
    socket.leave(`session:${sessionId}`);
  });

  // --- Terminal events ---
  socket.on('terminal:attach', (termId) => {
    socket.join(`terminal:${termId}`);
    log.info(`${socket.id} conectado a terminal ${termId}`);
  });

  socket.on('terminal:detach', (termId) => {
    socket.leave(`terminal:${termId}`);
  });

  socket.on('terminal:input', ({ termId, data }) => {
    terminalManager.write(termId, data);
  });

  socket.on('terminal:resize', ({ termId, cols, rows }) => {
    terminalManager.resize(termId, cols, rows);
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

// Terminal manager -> Socket.IO
terminalManager.on('data', (termId, data) => {
  io.to(`terminal:${termId}`).emit('terminal:data', { termId, data });
});

terminalManager.on('exit', (termId, exitCode) => {
  io.emit('terminal:exit', { termId, exitCode });
});

terminalManager.on('spawned', (terminal) => {
  io.emit('terminal:spawned', terminal);
});

// Violet -> Socket.IO
violetService.on('message', (msg) => {
  io.emit('violet:message', msg);
});

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
  terminalManager.killAll();
  await sessionWatcher.stop();
  httpServer.close();
  process.exit(0);
});

// Gestor de terminales PTY — multiplexer de terminales en el servidor
import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TermMgr');

export class TerminalManager extends EventEmitter {
  constructor() {
    super();
    // Mapa de terminales: id -> terminalInfo
    this.terminals = new Map();
    this.counter = 0;
  }

  /**
   * Crea una nueva terminal PTY
   */
  create({ name, cwd, shell, cols = 120, rows = 30 } = {}) {
    const id = `term-${++this.counter}-${Date.now()}`;
    const displayName = name || `Terminal ${this.counter}`;

    // Shell por defecto: bash (Git Bash) en Windows
    const defaultShell = process.platform === 'win32'
      ? 'C:\\Program Files\\Git\\bin\\bash.exe'
      : (process.env.SHELL || 'bash');
    const shellToUse = shell || defaultShell;

    log.info(`Creando terminal ${id}: ${shellToUse} en ${cwd || 'HOME'}`);

    const ptyProcess = pty.spawn(shellToUse, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || process.env.HOME || process.env.USERPROFILE || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const termInfo = {
      id,
      name: displayName,
      pid: ptyProcess.pid,
      shell: shellToUse,
      cwd: cwd || process.env.HOME || process.env.USERPROFILE,
      status: 'alive',
      cols,
      rows,
      createdAt: new Date().toISOString(),
      _pty: ptyProcess,
    };

    this.terminals.set(id, termInfo);

    // Datos de salida del PTY → evento
    ptyProcess.onData((data) => {
      this.emit('data', id, data);
    });

    // Proceso terminó
    ptyProcess.onExit(({ exitCode }) => {
      log.info(`Terminal ${id} salió con código ${exitCode}`);
      const term = this.terminals.get(id);
      if (term) {
        term.status = 'dead';
        term.exitCode = exitCode;
        term.endedAt = new Date().toISOString();
      }
      this.emit('exit', id, exitCode);
    });

    this.emit('spawned', this.serialize(termInfo));
    log.info(`Terminal ${id} creada (PID: ${ptyProcess.pid})`);

    return this.serialize(termInfo);
  }

  /**
   * Escribe datos (input del usuario) en la terminal
   */
  write(id, data) {
    const term = this.terminals.get(id);
    if (term && term.status === 'alive') {
      term._pty.write(data);
    }
  }

  /**
   * Redimensiona la terminal
   */
  resize(id, cols, rows) {
    const term = this.terminals.get(id);
    if (term && term.status === 'alive') {
      term._pty.resize(cols, rows);
      term.cols = cols;
      term.rows = rows;
    }
  }

  /**
   * Mata una terminal
   */
  kill(id) {
    const term = this.terminals.get(id);
    if (!term) return false;

    log.info(`Matando terminal ${id}`);
    if (term.status === 'alive') {
      term._pty.kill();
    }
    this.terminals.delete(id);
    return true;
  }

  /**
   * Obtiene una terminal por ID
   */
  get(id) {
    const term = this.terminals.get(id);
    return term ? this.serialize(term) : null;
  }

  /**
   * Lista todas las terminales
   */
  getAll() {
    return Array.from(this.terminals.values()).map((t) => this.serialize(t));
  }

  /**
   * Serializa info de terminal para enviar al frontend (sin _pty)
   */
  serialize(term) {
    const { _pty, ...rest } = term;
    return rest;
  }

  /**
   * Mata todas las terminales (cleanup al cerrar el servidor)
   */
  killAll() {
    for (const [id] of this.terminals) {
      this.kill(id);
    }
    log.info('Todas las terminales cerradas');
  }
}

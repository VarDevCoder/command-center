// Componente de terminal xterm.js con conexión Socket.IO
import { useRef, useEffect } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useSocket } from '../../context/SocketContext.jsx';
import '@xterm/xterm/css/xterm.css';

// Tema "Captain's Bridge" para la terminal
const BRIDGE_THEME = {
  background: '#0a0e14',
  foreground: '#c9d1d9',
  cursor: '#00d4ff',
  cursorAccent: '#0a0e14',
  selectionBackground: '#21262d80',
  black: '#0d1117',
  red: '#ff4444',
  green: '#00ff88',
  yellow: '#ffaa00',
  blue: '#00d4ff',
  magenta: '#b388ff',
  cyan: '#00d4ff',
  white: '#c9d1d9',
  brightBlack: '#484f58',
  brightRed: '#ff6666',
  brightGreen: '#33ff99',
  brightYellow: '#ffbb33',
  brightBlue: '#33ddff',
  brightMagenta: '#cc99ff',
  brightCyan: '#33ddff',
  brightWhite: '#f0f6fc',
};

export default function XTerminal({ termId }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const { socket } = useSocket();

  useEffect(() => {
    if (!containerRef.current || !socket || !termId) return;

    // Crear instancia de xterm.js
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      theme: BRIDGE_THEME,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    // Fit después de que el DOM se estabilice
    requestAnimationFrame(() => fitAddon.fit());

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Suscribirse al output de esta terminal
    socket.emit('terminal:attach', termId);

    // Recibir datos del PTY
    const onData = ({ termId: id, data }) => {
      if (id === termId) term.write(data);
    };
    socket.on('terminal:data', onData);

    // Enviar input del teclado al PTY
    const inputDisposable = term.onData((data) => {
      socket.emit('terminal:input', { termId, data });
    });

    // Manejar resize
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { termId, cols, rows });
    });

    // Observar cambios de tamaño del contenedor
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignorar errores si el terminal ya fue destruido
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      socket.emit('terminal:detach', termId);
      socket.off('terminal:data', onData);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [termId, socket]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '4px' }}
    />
  );
}

// Terminal Multiplexer — múltiples terminales PTY en el navegador
import { useState, useCallback } from 'react';
import { useTerminals } from '../hooks/useTerminals.js';
import { terminalApi } from '../services/api.js';
import TerminalTabBar from '../components/terminal/TerminalTabBar.jsx';
import XTerminal from '../components/terminal/XTerminal.jsx';
import { Terminal as TerminalIcon } from 'lucide-react';
import toast from 'react-hot-toast';

export default function TerminalPage() {
  const { terminals } = useTerminals();
  const [activeTermId, setActiveTermId] = useState(null);
  const [creating, setCreating] = useState(false);

  // Crear nueva terminal
  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const term = await terminalApi.create({
        name: `Terminal ${terminals.length + 1}`,
      });
      setActiveTermId(term.id);
      toast.success('Terminal creada');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }, [terminals.length]);

  // Cerrar terminal
  const handleClose = useCallback(async (termId) => {
    try {
      await terminalApi.kill(termId);
      if (termId === activeTermId) {
        const remaining = terminals.filter((t) => t.id !== termId);
        setActiveTermId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      toast.success('Terminal cerrada');
    } catch (err) {
      toast.error(err.message);
    }
  }, [activeTermId, terminals]);

  // Auto-seleccionar primera terminal si no hay activa
  if (!activeTermId && terminals.length > 0) {
    setActiveTermId(terminals[0].id);
  }

  // Vista vacía
  if (terminals.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <TerminalIcon className="w-12 h-12 mx-auto mb-4 text-bridge-600" />
          <h2 className="font-mono text-lg text-bridge-300 mb-2">
            No Active Terminals
          </h2>
          <p className="text-sm text-bridge-500 mb-6">
            Abre una terminal para ejecutar comandos.
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 rounded-lg bg-cyan-glow/10 text-cyan-glow
              border border-cyan-glow/30 hover:bg-cyan-glow/20
              font-mono text-sm transition-colors"
          >
            {creating ? 'Creating...' : 'New Terminal'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <TerminalTabBar
        terminals={terminals}
        activeTermId={activeTermId}
        onSelect={setActiveTermId}
        onClose={handleClose}
        onCreate={handleCreate}
        creating={creating}
      />

      {/* Todas las terminales se renderizan pero solo la activa es visible */}
      <div className="flex-1 min-h-0 relative">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`absolute inset-0 ${t.id === activeTermId ? 'block' : 'hidden'}`}
          >
            <XTerminal termId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

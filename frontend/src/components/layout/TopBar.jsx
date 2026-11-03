// Barra superior — estilo mission control
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, Activity } from 'lucide-react';
import { useSocket } from '../../context/SocketContext.jsx';
import { useAgents } from '../../hooks/useAgents.js';

export default function TopBar() {
  const { connected } = useSocket();
  const { activeCount } = useAgents();
  const [clock, setClock] = useState(formatClock());

  // Reloj en tiempo real
  useEffect(() => {
    const interval = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-14 bg-bridge-800 border-b border-bridge-700 flex items-center justify-between px-6">
      {/* Izquierda: título */}
      <div className="flex items-center gap-3">
        <h1 className="font-mono text-sm font-semibold text-bridge-200 tracking-wide">
          COMMAND CENTER
        </h1>
        <span className="text-[10px] font-mono text-bridge-500 bg-bridge-700 px-2 py-0.5 rounded">
          CONTROL PANEL
        </span>
      </div>

      {/* Centro: reloj */}
      <div className="font-mono text-lg font-semibold text-cyan-glow tracking-widest">
        {clock}
      </div>

      {/* Derecha: status */}
      <div className="flex items-center gap-4">
        <Link
          to="/"
          className="flex items-center gap-2 rounded text-sm font-mono text-bridge-300 hover:text-cyan-glow transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-glow"
        >
          <Activity className="w-4 h-4 text-green-glow" />
          {activeCount} {activeCount === 1 ? 'Agent' : 'Agents'} Running
        </Link>

        {/* Sin conexión el conteo puede estar desactualizado */}
        {!connected && (
          <div className="flex items-center gap-1.5">
            <WifiOff className="w-4 h-4 text-red-glow" />
            <span className="text-[10px] font-mono text-red-glow">OFFLINE</span>
          </div>
        )}
      </div>
    </header>
  );
}

function formatClock() {
  return new Date().toLocaleTimeString('es-AR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

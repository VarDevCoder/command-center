// Barra superior — estilo mission control
import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Activity } from 'lucide-react';
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
          CAPTAIN&apos;S BRIDGE
        </span>
      </div>

      {/* Centro: reloj */}
      <div className="font-mono text-lg font-semibold text-cyan-glow tracking-widest">
        {clock}
      </div>

      {/* Derecha: status */}
      <div className="flex items-center gap-4">
        {/* Agentes activos */}
        <div className="flex items-center gap-2 text-sm font-mono">
          <Activity className="w-4 h-4 text-green-glow" />
          <span className="text-bridge-300">
            {activeCount}
          </span>
          <span className="text-bridge-500 text-xs">live</span>
        </div>

        {/* Conexión Socket */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <Wifi className="w-4 h-4 text-green-glow" />
              <span className="text-[10px] font-mono text-green-glow">ONLINE</span>
            </>
          ) : (
            <>
              <WifiOff className="w-4 h-4 text-red-glow" />
              <span className="text-[10px] font-mono text-red-glow">OFFLINE</span>
            </>
          )}
        </div>
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

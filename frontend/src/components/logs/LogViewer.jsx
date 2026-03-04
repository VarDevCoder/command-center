// Visor de logs estilo terminal con auto-scroll
import { useRef, useEffect } from 'react';
import LogEntry from './LogEntry.jsx';
import { Terminal } from 'lucide-react';

export default function LogViewer({ entries = [], className = '' }) {
  const containerRef = useRef(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll cuando llegan nuevos entries
  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Detectar si el usuario scrolleó manualmente
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    shouldAutoScroll.current = atBottom;
  };

  if (!entries || entries.length === 0) {
    return (
      <div className={`bg-bridge-950 rounded-lg border border-bridge-700 flex items-center justify-center ${className}`}>
        <div className="text-center text-bridge-500">
          <Terminal className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="font-mono text-xs">Esperando logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`bg-bridge-950 rounded-lg border border-bridge-700 overflow-auto ${className}`}
    >
      <div className="p-2">
        {entries.map((entry, i) => (
          <LogEntry key={`${entry.timestamp}-${i}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}

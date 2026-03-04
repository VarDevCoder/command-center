// Tab individual de terminal en la barra
import { X, Terminal } from 'lucide-react';

export default function TerminalTab({ terminal, isActive, onSelect, onClose }) {
  return (
    <button
      onClick={() => onSelect(terminal.id)}
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b-2
        transition-colors text-xs font-mono group min-w-0 shrink-0 ${
        isActive
          ? 'border-cyan-glow text-cyan-glow bg-bridge-950'
          : 'border-transparent text-bridge-400 hover:text-bridge-200 hover:bg-bridge-800'
      }`}
    >
      <Terminal className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate max-w-[120px]">
        {terminal.name || `Terminal ${terminal.id.split('-')[1]}`}
      </span>
      {terminal.status === 'dead' && (
        <span className="text-[9px] text-red-glow">[exited]</span>
      )}
      <span
        onClick={(e) => { e.stopPropagation(); onClose(terminal.id); }}
        className="ml-1 p-0.5 rounded hover:bg-bridge-700 opacity-0
          group-hover:opacity-100 transition-opacity"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  );
}

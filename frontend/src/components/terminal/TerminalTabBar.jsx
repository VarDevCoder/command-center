// Barra de tabs de terminales con botón de nueva terminal
import { Plus } from 'lucide-react';
import TerminalTab from './TerminalTab.jsx';

export default function TerminalTabBar({
  terminals,
  activeTermId,
  onSelect,
  onClose,
  onCreate,
  creating,
}) {
  return (
    <div className="flex items-center bg-bridge-800 border-b border-bridge-700 overflow-x-auto">
      <div className="flex items-center flex-1 min-w-0">
        {terminals.map((t) => (
          <TerminalTab
            key={t.id}
            terminal={t}
            isActive={t.id === activeTermId}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>

      <button
        onClick={onCreate}
        disabled={creating}
        className="shrink-0 p-2 mx-1 rounded hover:bg-bridge-700
          text-bridge-400 hover:text-cyan-glow transition-colors
          disabled:opacity-30"
        title="Nueva terminal"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

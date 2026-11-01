// Badge de estado con dot animado
const STATUS_CONFIG = {
  active: { color: 'bg-green-glow', text: 'text-green-glow', label: 'ACTIVE', pulse: true },
  spawning: { color: 'bg-cyan-glow', text: 'text-cyan-glow', label: 'SPAWNING', pulse: true },
  thinking: { color: 'bg-amber-glow', text: 'text-amber-glow', label: 'THINKING', pulse: true },
  completed: { color: 'bg-bridge-400', text: 'text-bridge-400', label: 'DONE', pulse: false },
  error: { color: 'bg-red-glow', text: 'text-red-glow', label: 'ERROR', pulse: false },
  stopped: { color: 'bg-red-glow', text: 'text-red-glow', label: 'STOPPED', pulse: false },
  stopping: { color: 'bg-amber-glow', text: 'text-amber-glow', label: 'STOPPING', pulse: true },
  idle: { color: 'bg-bridge-500', text: 'text-bridge-500', label: 'IDLE', pulse: false },
  running: { color: 'bg-green-glow', text: 'text-green-glow', label: 'RUNNING', pulse: true },
  reviewing: { color: 'bg-cyan-glow', text: 'text-cyan-glow', label: 'REVIEWING', pulse: true },
  'needs-escalation': { color: 'bg-amber-glow', text: 'text-amber-glow', label: 'ESCALATED', pulse: false },
  done: { color: 'bg-bridge-400', text: 'text-bridge-400', label: 'DONE', pulse: false },
};

export default function StatusBadge({ status = 'idle', size = 'sm' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const dotSize = size === 'lg' ? 'w-3 h-3' : 'w-2 h-2';

  return (
    <div className="flex items-center gap-1.5">
      <span className={`${dotSize} rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className={`font-mono text-[10px] uppercase tracking-wider ${config.text}`}>
        {config.label}
      </span>
    </div>
  );
}

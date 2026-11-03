// Tarjeta de agente — estilo station monitor
import { useNavigate } from 'react-router-dom';
import { Terminal, Clock, Cpu } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { truncate, projectName, timeAgo, formatTokens } from '../../utils/formatters.js';

const GLOW_MAP = {
  active: 'shadow-[0_0_15px_rgba(0,255,136,0.1)] border-green-glow/30',
  spawning: 'shadow-[0_0_15px_rgba(0,212,255,0.1)] border-cyan-glow/30',
  thinking: 'shadow-[0_0_15px_rgba(255,170,0,0.1)] border-amber-glow/30',
  error: 'shadow-[0_0_10px_rgba(255,68,68,0.1)] border-red-glow/30',
  stopped: 'border-red-glow/20',
  completed: 'border-bridge-600',
  idle: 'border-bridge-700',
};

export default function AgentCard({ agent }) {
  const navigate = useNavigate();
  const glow = GLOW_MAP[agent.status] || GLOW_MAP.idle;
  // Última actividad mientras corre; al terminar, la tarea identifica mejor la ejecución.
  const lastLog = agent.status === 'active'
    ? agent.logs?.filter((log) => log.type !== 'system').at(-1)
    : null;

  return (
    <button
      onClick={() => navigate(`/agent/${agent.id}`)}
      className={`w-full text-left bg-bridge-900 border rounded-lg p-4
        transition-all duration-300 hover:bg-bridge-800 cursor-pointer ${glow}`}
    >
      {/* Header: status + ID */}
      <div className="flex items-center justify-between mb-3">
        <StatusBadge status={agent.status} />
        <span className="font-mono text-[10px] text-bridge-500">
          {agent.id?.split('-').slice(0, 2).join('-')}
        </span>
      </div>

      {/* Proyecto */}
      <div className="flex items-center gap-2 mb-2">
        <Terminal className="w-3.5 h-3.5 text-purple-glow flex-shrink-0" />
        <span className="font-mono text-xs text-bridge-300 truncate">
          {projectName(agent.projectDir)}
        </span>
      </div>

      {/* Prompt / última acción */}
      <p className="text-xs text-bridge-400 mb-3 line-clamp-2 min-h-[32px]">
        {lastLog?.content
          ? truncate(lastLog.content, 100)
          : truncate(agent.prompt, 100)}
      </p>

      {/* Footer: tiempo + tokens */}
      <div className="flex items-center justify-between text-[10px] font-mono text-bridge-500">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{timeAgo(agent.startedAt)}</span>
        </div>
        {(agent.tokensIn > 0 || agent.tokensOut > 0) && (
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            <span>{formatTokens(agent.tokensIn + agent.tokensOut)}</span>
          </div>
        )}
      </div>
    </button>
  );
}

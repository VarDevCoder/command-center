// Historial de las ejecuciones de agentes lanzados desde Command Center
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search, Clock, Cpu } from 'lucide-react';
import { useAgents } from '../hooks/useAgents.js';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/agents/StatusBadge.jsx';
import { formatDateTime, truncate, projectName } from '../utils/formatters.js';

export default function HistoryPage() {
  const navigate = useNavigate();
  const { agents, loading, error } = useAgents();
  const [search, setSearch] = useState('');

  const runs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...agents].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    if (!q) return sorted;
    return sorted.filter((run) =>
      [run.id, run.prompt, run.projectDir, run.provider, run.model, run.status]
        .some((value) => value?.toLowerCase().includes(q))
    );
  }, [agents, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-bridge-900 border border-bridge-700 rounded-lg px-4 py-2">
        <Search className="w-4 h-4 text-bridge-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por tarea, proyecto, proveedor o estado..."
          className="flex-1 bg-transparent text-sm font-mono text-bridge-200 placeholder-bridge-600
            focus:outline-none"
        />
        <span className="font-mono text-[10px] text-bridge-500">
          {runs.length} / {agents.length}
        </span>
      </div>

      <Card title="Ejecuciones de agentes">
        <div className="divide-y divide-bridge-700/50">
          {loading ? (
            <p className="p-8 text-center font-mono text-sm text-bridge-500">Cargando ejecuciones...</p>
          ) : error ? (
            <p className="p-8 text-center font-mono text-sm text-red-glow">No se pudo cargar el historial: {error}</p>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-bridge-500">
              <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-mono text-sm">
                {search ? 'No hay resultados' : 'Todavía no se ejecutó ningún agente'}
              </p>
            </div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                onClick={() => navigate(`/agent/${run.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-bridge-800/50 transition-colors flex items-center gap-4"
              >
                <div className="w-24 flex-shrink-0">
                  <StatusBadge status={run.status} />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm text-bridge-200 truncate font-mono">
                    {truncate(run.prompt, 100) || 'Sin descripción'}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] font-mono text-bridge-500">
                    <span>{projectName(run.projectDir)}</span>
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {run.provider} · {run.model}
                    </span>
                    <span>{run.logs?.length ? 'con logs' : 'sin logs'}</span>
                  </div>
                </div>

                <div className="flex-shrink-0 text-right font-mono text-[10px] text-bridge-600">
                  <p className="flex items-center justify-end gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDateTime(run.startedAt)}
                  </p>
                  {run.endedAt && <p className="mt-1">fin {formatDateTime(run.endedAt)}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

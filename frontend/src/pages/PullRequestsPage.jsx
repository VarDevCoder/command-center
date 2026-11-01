// Vista global de "Pull Requests pendientes" — todas las tareas del
// pipeline supervisado, de cualquier repo/proveedor, en un solo lugar.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { GitPullRequest, GitBranch, CheckCircle2 } from 'lucide-react';
import { supervisedApi } from '../services/api.js';
import { useSocket } from '../context/SocketContext.jsx';
import { VERDICT_STYLE } from '../utils/verdictStyle.js';
import { timeAgo, projectName } from '../utils/formatters.js';
import toast from 'react-hot-toast';

const STATUS_LABEL = {
  working: 'Trabajando',
  reviewing: 'Revisando',
  retrying: 'Corrigiendo',
  'no-changes': 'Sin cambios',
  'escalated-rejected': 'Rechazado',
  'escalated-unresolved': 'Sin resolver',
  'pr-open': 'PR listo',
  'publish-error': 'Error al publicar',
  merged: 'Mergeado',
  error: 'Error',
};

export default function PullRequestsPage() {
  const { socket } = useSocket();
  const [tasks, setTasks] = useState([]);
  const [filters, setFilters] = useState({ provider: '', status: '' });
  const [expanded, setExpanded] = useState(null);
  const [merging, setMerging] = useState(null);

  const load = () => {
    supervisedApi.list(filters).then(setTasks).catch(() => toast.error('Error cargando tareas'));
  };

  useEffect(() => { load(); }, [filters.provider, filters.status]);

  useEffect(() => {
    if (!socket) return;
    const onChange = () => load();
    socket.on('supervised:started', onChange);
    socket.on('supervised:statusChange', onChange);
    socket.on('supervised:reviewResult', onChange);
    socket.on('supervised:prCreated', onChange);
    socket.on('supervised:publishError', onChange);
    socket.on('supervised:merged', onChange);
    return () => {
      socket.off('supervised:started', onChange);
      socket.off('supervised:statusChange', onChange);
      socket.off('supervised:reviewResult', onChange);
      socket.off('supervised:prCreated', onChange);
      socket.off('supervised:publishError', onChange);
      socket.off('supervised:merged', onChange);
    };
  }, [socket]);

  const handleMerge = async (taskId) => {
    setMerging(taskId);
    try {
      await supervisedApi.merge(taskId);
      toast.success('PR mergeado');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMerging(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={filters.provider}
          onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
          className="bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2 text-sm text-bridge-200"
        >
          <option value="">Todos los proveedores</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="ollama">Ollama</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2 text-sm text-bridge-200"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="bg-bridge-900 border border-bridge-700 rounded-lg divide-y divide-bridge-800">
        {tasks.length === 0 && (
          <p className="px-4 py-8 text-center font-mono text-xs text-bridge-500">
            Sin tareas supervisadas todavía
          </p>
        )}
        {tasks.map((task) => {
          const isExpanded = expanded === task.taskId;
          const lastReview = task.reviewCycles?.[task.reviewCycles.length - 1];
          const canMerge = task.status === 'pr-open' && task.pr?.headSha === task.approvedSha;

          return (
            <div key={task.taskId}>
              <button
                onClick={() => setExpanded(isExpanded ? null : task.taskId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bridge-800/60 transition-colors"
              >
                <GitBranch className="w-4 h-4 text-bridge-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-bridge-200 truncate">
                    {projectName(task.repoFullName || task.projectDir)}
                    <span className="text-[10px] text-bridge-500 ml-2">{task.provider}</span>
                  </p>
                  <p className="text-xs text-bridge-500 truncate">{task.prompt}</p>
                </div>
                <span className="text-[10px] font-mono text-bridge-400 flex-shrink-0">
                  {STATUS_LABEL[task.status] || task.status}
                </span>
                <span className="text-[10px] font-mono text-bridge-600 flex-shrink-0">
                  {timeAgo(task.startedAt)}
                </span>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  {lastReview && (() => {
                    const style = VERDICT_STYLE[lastReview.verdict] || VERDICT_STYLE['FIX-NEEDED'];
                    return (
                      <div className={`px-3 py-2 rounded-lg border ${style.border} ${style.bg}`}>
                        <p className={`font-mono text-xs font-semibold ${style.color}`}>{lastReview.verdict}</p>
                        <p className="text-xs text-bridge-300 mt-1 whitespace-pre-wrap">{lastReview.notes}</p>
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-3">
                    {task.pr && (
                      <a
                        href={task.pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-cyan-glow text-xs hover:underline"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        PR #{task.pr.number}
                      </a>
                    )}
                    <Link to={`/agent/${task.taskId}`} className="text-xs text-bridge-400 hover:text-bridge-200">
                      Ver detalle completo →
                    </Link>
                  </div>

                  {canMerge && (
                    <button
                      onClick={() => handleMerge(task.taskId)}
                      disabled={merging === task.taskId}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-glow/10 text-green-glow border border-green-glow/30 hover:bg-green-glow/20 disabled:opacity-30 text-sm font-mono transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {merging === task.taskId ? 'Integrando...' : 'Aprobar e integrar'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Panel del pipeline supervisado: rama, commits, ciclo de revisión, PR y
// el botón de aprobar/integrar. Se muestra junto al log en vivo del agente
// (LogViewer u OllamaTaskView), no lo reemplaza.
import { useState, useEffect } from 'react';
import { GitBranch, GitPullRequest, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { supervisedApi } from '../../services/api.js';
import { useSocket } from '../../context/SocketContext.jsx';
import { VERDICT_STYLE } from '../../utils/verdictStyle.js';
import toast from 'react-hot-toast';

export default function SupervisedTaskView({ taskId }) {
  const { socket } = useSocket();
  const [task, setTask] = useState(null);
  const [merging, setMerging] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = () => {
    supervisedApi.get(taskId).then(setTask).catch(() => {});
  };

  useEffect(() => { load(); }, [taskId]);

  useEffect(() => {
    if (!socket) return;
    const matches = (p) => p.taskId === taskId;
    const onAny = (p) => { if (matches(p)) load(); };

    socket.on('supervised:started', onAny);
    socket.on('supervised:statusChange', onAny);
    socket.on('supervised:reviewResult', onAny);
    socket.on('supervised:prCreated', onAny);
    socket.on('supervised:publishError', onAny);
    socket.on('supervised:merged', onAny);

    return () => {
      socket.off('supervised:started', onAny);
      socket.off('supervised:statusChange', onAny);
      socket.off('supervised:reviewResult', onAny);
      socket.off('supervised:prCreated', onAny);
      socket.off('supervised:publishError', onAny);
      socket.off('supervised:merged', onAny);
    };
  }, [socket, taskId]);

  if (!task) return null;

  const lastReview = task.reviewCycles?.[task.reviewCycles.length - 1];
  const canMerge = task.status === 'pr-open' && task.pr?.headSha === task.approvedSha;

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await supervisedApi.publish(taskId);
      toast.success('Publicación reintentada');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleMerge = async () => {
    setMerging(true);
    try {
      await supervisedApi.merge(taskId);
      toast.success('PR mergeado');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="bg-bridge-900 border border-bridge-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 font-mono text-xs text-bridge-400">
        <GitBranch className="w-3.5 h-3.5" />
        <span>{task.branch}</span>
        {task.baseBranch && <span className="text-bridge-600">→ {task.baseBranch}</span>}
      </div>

      {task.reviewCycles?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono text-bridge-500 uppercase tracking-wider">
            Ciclo de revisión ({task.reviewCycles.length})
          </p>
          {task.reviewCycles.map((c, i) => {
            const style = VERDICT_STYLE[c.verdict] || VERDICT_STYLE['FIX-NEEDED'];
            const Icon = style.icon;
            return (
              <div key={i} className={`px-3 py-2 rounded-lg border ${style.border} ${style.bg}`}>
                <div className={`flex items-center gap-2 font-mono text-xs font-semibold ${style.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                  intento {c.attempt} · {c.verdict}
                </div>
                {c.reviewer && (
                  <p className="mt-1 text-[10px] font-mono text-bridge-500">
                    revisor: {c.reviewer.provider} · {c.reviewer.model} · razonamiento {c.reviewer.effort}
                  </p>
                )}
                <p className="text-xs text-bridge-300 mt-1.5 whitespace-pre-wrap">{c.notes}</p>
              </div>
            );
          })}
        </div>
      )}

      {(task.status === 'escalated-rejected' || task.status === 'escalated-unresolved') && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-glow/10 border border-amber-glow/40 text-amber-glow text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {task.status === 'escalated-rejected'
            ? 'Rechazado por un problema grave — no se reintentó automáticamente.'
            : 'No se resolvió tras los reintentos automáticos.'} La rama quedó intacta.
        </div>
      )}

      {task.status === 'publish-error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-glow/10 border border-red-glow/40 text-red-glow text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            No se pudo publicar el PR: {task.lastError}
          </div>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30 hover:bg-cyan-glow/20 disabled:opacity-30 text-xs font-mono transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {publishing ? 'Reintentando...' : 'Reintentar publicación'}
          </button>
        </div>
      )}

      {task.pr && (
        <div className="space-y-2">
          <a
            href={task.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-cyan-glow text-sm hover:underline"
          >
            <GitPullRequest className="w-4 h-4" />
            PR #{task.pr.number}
          </a>
          {task.status === 'merged' ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-glow/10 border border-green-glow/40 text-green-glow text-xs">
              <CheckCircle2 className="w-4 h-4" />
              Mergeado el {new Date(task.mergeRecord?.mergedAt).toLocaleString()}
            </div>
          ) : canMerge ? (
            <button
              onClick={handleMerge}
              disabled={merging}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-glow/10 text-green-glow border border-green-glow/30 hover:bg-green-glow/20 disabled:opacity-30 text-sm font-mono transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {merging ? 'Integrando...' : 'Aprobar e integrar'}
            </button>
          ) : (
            <p className="text-[10px] text-bridge-500">
              {lastReview?.verdict === 'APPROVE' ? 'Esperando confirmación...' : 'El código cambió desde la última revisión — hace falta revisar de nuevo antes de poder mergear.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

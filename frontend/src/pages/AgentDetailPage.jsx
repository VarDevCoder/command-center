// Vista detallada de una ejecución de agente, en curso o terminada
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, StopCircle, Terminal, Cpu, Clock } from 'lucide-react';
import LogViewer from '../components/logs/LogViewer.jsx';
import CommandInput from '../components/common/CommandInput.jsx';
import StatusBadge from '../components/agents/StatusBadge.jsx';
import OllamaTaskView from '../components/agents/OllamaTaskView.jsx';
import SupervisedTaskView from '../components/agents/SupervisedTaskView.jsx';
import { agentApi } from '../services/api.js';
import { useAgents } from '../hooks/useAgents.js';
import { projectName, formatTokens, formatDateTime } from '../utils/formatters.js';
import toast from 'react-hot-toast';

export default function AgentDetailPage() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const { agents, loading } = useAgents();
  const [savedLogs, setSavedLogs] = useState([]);

  const agent = agents.find((a) => a.id === agentId);
  const isOllama = agent?.provider === 'ollama';
  const isSupervised = Boolean(agent?.supervised) || isOllama;

  // La lista en vivo solo trae los últimos logs: el historial completo se pide aparte.
  useEffect(() => {
    setSavedLogs([]);
    agentApi.get(agentId)
      .then((full) => setSavedLogs(full.logs || []))
      .catch(() => {});
  }, [agentId]);

  const liveLogs = agent?.logs || [];
  const lastSaved = savedLogs.at(-1)?.timestamp;
  const logs = lastSaved
    ? [...savedLogs, ...liveLogs.filter((log) => log.timestamp > lastSaved)]
    : liveLogs;

  const displayData = agent || { status: 'idle' };
  const isLive = agent?.status === 'active' || agent?.status === 'spawning';

  const handleSend = async (prompt) => {
    try {
      await agentApi.send(agentId, prompt);
      toast.success('Comando enviado');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleStop = async () => {
    try {
      await agentApi.stop(agentId);
      toast.success('Agente detenido');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 font-mono text-sm text-bridge-500">
        Cargando...
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 font-mono text-sm text-bridge-500">
        <p>Esta ejecución no existe o ya no está guardada.</p>
        <button onClick={() => navigate('/history')} className="text-cyan-glow hover:underline text-xs">
          Ir a History
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-bridge-800 text-bridge-400 hover:text-bridge-200 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <StatusBadge status={displayData.status} size="lg" />
              <h2 className="font-mono text-sm text-bridge-200">{agentId}</h2>
            </div>
            <div className="flex items-center gap-4 mt-1 text-[10px] font-mono text-bridge-500">
              <span className="flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                {projectName(displayData.projectDir)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDateTime(displayData.startedAt)}
              </span>
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {formatTokens(displayData.tokensIn)} in / {formatTokens(displayData.tokensOut)} out
              </span>
            </div>
          </div>
        </div>

        {!isSupervised && agent.status === 'active' && (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-3 py-2 rounded-lg
              bg-red-glow/10 text-red-glow border border-red-glow/30
              hover:bg-red-glow/20 transition-colors text-sm font-mono"
          >
            <StopCircle className="w-4 h-4" />
            Stop
          </button>
        )}
      </div>

      {/* Panel de rama/revisión/PR (todos los proveedores en modo protegido) */}
      {isSupervised && <SupervisedTaskView taskId={agentId} />}

      {/* Log viewer (Claude/Codex) o vista de turnos (Ollama) */}
      {isOllama ? (
        <OllamaTaskView taskId={agentId} />
      ) : (
        <LogViewer
          entries={logs}
          emptyText={isLive ? 'Esperando logs...' : 'Esta ejecución no tiene logs guardados.'}
          className="flex-1 min-h-0"
        />
      )}

      {/* Command input (solo para agentes activos en modo directo) */}
      {!isSupervised && (
        <CommandInput
          onSend={handleSend}
          onStop={agent.status === 'active' ? handleStop : null}
          disabled={agent.status !== 'active'}
          placeholder={agent.status === 'active' ? 'Enviar comando al agente...' : 'Agente no activo'}
        />
      )}
    </div>
  );
}

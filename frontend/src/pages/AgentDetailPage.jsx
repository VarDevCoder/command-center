// Vista detallada de un agente o sesión histórica
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, StopCircle, Terminal, Cpu, Clock } from 'lucide-react';
import LogViewer from '../components/logs/LogViewer.jsx';
import CommandInput from '../components/common/CommandInput.jsx';
import StatusBadge from '../components/agents/StatusBadge.jsx';
import { agentApi, sessionApi } from '../services/api.js';
import { useAgents } from '../hooks/useAgents.js';
import { projectName, formatTokens, formatDateTime } from '../utils/formatters.js';
import toast from 'react-hot-toast';

export default function AgentDetailPage() {
  const { agentId, sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { agents } = useAgents();

  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);

  const isHistorical = location.pathname.startsWith('/history/');
  const agent = agents.find((a) => a.id === agentId);

  // Cargar datos de sesión histórica
  useEffect(() => {
    if (!isHistorical || !sessionId) {
      setLoading(false);
      return;
    }
    sessionApi.get(sessionId)
      .then(setSessionData)
      .catch(() => toast.error('Error cargando sesión'))
      .finally(() => setLoading(false));
  }, [sessionId, isHistorical]);

  // Datos a mostrar (agente activo o sesión histórica)
  const displayData = isHistorical
    ? {
        status: 'completed',
        projectDir: sessionData?.project || '',
        prompt: sessionData?.preview || '',
        startedAt: sessionData?.firstTimestamp,
        logs: sessionData?.entries || [],
        tokensIn: sessionData?.totalTokens?.input || 0,
        tokensOut: sessionData?.totalTokens?.output || 0,
      }
    : agent || { status: 'idle', logs: [] };

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
              <h2 className="font-mono text-sm text-bridge-200">
                {agentId || sessionId?.slice(0, 8)}
              </h2>
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

        {!isHistorical && agent?.status === 'active' && (
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

      {/* Log viewer */}
      <LogViewer entries={displayData.logs} className="flex-1 min-h-0" />

      {/* Command input (solo para agentes activos) */}
      {!isHistorical && (
        <CommandInput
          onSend={handleSend}
          onStop={agent?.status === 'active' ? handleStop : null}
          disabled={!agent || agent.status !== 'active'}
          placeholder={agent?.status === 'active' ? 'Enviar comando al agente...' : 'Agente no activo'}
        />
      )}
    </div>
  );
}

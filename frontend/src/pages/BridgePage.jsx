// Pantalla principal — Control Panel
import { useState, useEffect } from 'react';
import { Activity, Clock, MessageSquare, Zap, ArrowRight, Rocket } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAgents } from '../hooks/useAgents.js';
import AgentGrid from '../components/agents/AgentGrid.jsx';
import Card from '../components/common/Card.jsx';
import { sessionApi } from '../services/api.js';

const RECENT_AGENTS = 12;

export default function BridgePage() {
  const { agents, loading } = useAgents();
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    sessionApi.list(100)
      .then(setSessions)
      .catch(() => {});
  }, []);

  const activeAgents = agents.filter((a) => a.status === 'active' || a.status === 'spawning');
  const completedAgents = agents.filter((a) => a.status === 'completed');
  const errorAgents = agents.filter((a) => a.status === 'error' || a.status === 'stopped');
  const recentAgents = [...agents]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, RECENT_AGENTS);

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Activos" value={activeAgents.length} color="text-green-glow" />
        <StatCard icon={Zap} label="Finalizados" value={completedAgents.length} color="text-cyan-glow" />
        <StatCard icon={Clock} label="Detenidos" value={errorAgents.length} color="text-red-glow" />
        <StatCard icon={MessageSquare} label="Sessions" value={sessions.length} color="text-purple-glow" />
      </div>

      <Card title="Agentes" action={
        <Link to="/history" aria-label="Ver todas las ejecuciones" className="text-bridge-500 hover:text-cyan-glow transition-colors">
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      }>
        <div className="p-4">
          {loading ? (
            <div className="text-center py-8 font-mono text-sm text-bridge-500">
              Cargando agentes...
            </div>
          ) : agents.length === 0 ? (
            <EmptyAgents />
          ) : (
            <AgentGrid agents={recentAgents} />
          )}
        </div>
      </Card>
    </div>
  );
}

function EmptyAgents() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-bridge-500">
      <Rocket className="w-10 h-10 mb-4 opacity-30" />
      <p className="font-mono text-sm text-bridge-400">Todavía no hay agentes</p>
      <Link
        to="/launch"
        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg
          bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
          hover:bg-cyan-glow/20 font-mono text-xs font-semibold transition-colors"
      >
        <Rocket className="w-3.5 h-3.5" />
        LANZAR AGENTE
      </Link>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-bridge-900 border border-bridge-700 rounded-lg p-4 flex items-center gap-3">
      <Icon className={`w-5 h-5 ${color}`} />
      <div>
        <p className={`font-mono text-lg font-bold ${color}`}>{value}</p>
        <p className="font-mono text-[10px] text-bridge-500 uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}

// Dashboard principal — Captain's Bridge
import { useState, useEffect } from 'react';
import { Activity, Clock, MessageSquare, Zap } from 'lucide-react';
import { useAgents } from '../hooks/useAgents.js';
import AgentGrid from '../components/agents/AgentGrid.jsx';
import Card from '../components/common/Card.jsx';
import { sessionApi } from '../services/api.js';

export default function BridgePage() {
  const { agents, loading } = useAgents();
  const [stats, setStats] = useState({ sessions: 0 });

  // Cargar estadísticas básicas
  useEffect(() => {
    sessionApi.list(100)
      .then((sessions) => setStats({ sessions: sessions.length }))
      .catch(() => {});
  }, []);

  const activeAgents = agents.filter((a) => a.status === 'active' || a.status === 'spawning');
  const completedAgents = agents.filter((a) => a.status === 'completed');
  const errorAgents = agents.filter((a) => a.status === 'error' || a.status === 'stopped');

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="Active"
          value={activeAgents.length}
          color="text-green-glow"
        />
        <StatCard
          icon={Zap}
          label="Completed"
          value={completedAgents.length}
          color="text-cyan-glow"
        />
        <StatCard
          icon={Clock}
          label="Errors"
          value={errorAgents.length}
          color="text-red-glow"
        />
        <StatCard
          icon={MessageSquare}
          label="Sessions"
          value={stats.sessions}
          color="text-purple-glow"
        />
      </div>

      {/* Grid de agentes */}
      <Card title="Active Agents">
        <div className="p-4">
          {loading ? (
            <div className="text-center py-8 font-mono text-sm text-bridge-500">
              Cargando agentes...
            </div>
          ) : (
            <AgentGrid agents={agents} />
          )}
        </div>
      </Card>
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

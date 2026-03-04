// Grid de tarjetas de agentes
import AgentCard from './AgentCard.jsx';
import { Radio } from 'lucide-react';

export default function AgentGrid({ agents }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-bridge-500">
        <Radio className="w-12 h-12 mb-4 opacity-30" />
        <p className="font-mono text-sm">No hay agentes activos</p>
        <p className="text-xs mt-1">Lanza un agente desde Mission Control</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

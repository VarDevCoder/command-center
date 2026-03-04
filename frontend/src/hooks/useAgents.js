// Hook para estado de agentes en tiempo real via Socket.IO
import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { agentApi } from '../services/api.js';

export function useAgents() {
  const { socket } = useSocket();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Carga inicial via REST
  useEffect(() => {
    agentApi.list()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, []);

  // Escuchar eventos de Socket.IO
  useEffect(() => {
    if (!socket) return;

    const onList = (list) => setAgents(list);

    const onSpawned = (agent) => {
      setAgents((prev) => [...prev, agent]);
    };

    const onUpdate = (updated) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a))
      );
    };

    const onLog = ({ agentId, ...logEntry }) => {
      setAgents((prev) =>
        prev.map((a) => {
          if (a.id !== agentId) return a;
          const logs = [...(a.logs || []), logEntry].slice(-50);
          return { ...a, logs };
        })
      );
    };

    socket.on('agent:list', onList);
    socket.on('agent:spawned', onSpawned);
    socket.on('agent:update', onUpdate);
    socket.on('agent:log', onLog);

    return () => {
      socket.off('agent:list', onList);
      socket.off('agent:spawned', onSpawned);
      socket.off('agent:update', onUpdate);
      socket.off('agent:log', onLog);
    };
  }, [socket]);

  const refresh = useCallback(() => {
    agentApi.list().then(setAgents).catch(() => {});
  }, []);

  const activeCount = agents.filter(
    (a) => a.status === 'active' || a.status === 'spawning'
  ).length;

  return { agents, loading, refresh, activeCount };
}

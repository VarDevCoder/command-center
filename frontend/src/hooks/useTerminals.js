// Hook para estado de terminales en tiempo real via Socket.IO
import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { terminalApi } from '../services/api.js';

export function useTerminals() {
  const { socket } = useSocket();
  const [terminals, setTerminals] = useState([]);
  const [loading, setLoading] = useState(true);

  // Carga inicial via REST
  useEffect(() => {
    terminalApi.list()
      .then(setTerminals)
      .catch(() => setTerminals([]))
      .finally(() => setLoading(false));
  }, []);

  // Escuchar eventos de Socket.IO
  useEffect(() => {
    if (!socket) return;

    const onList = (list) => setTerminals(list);

    const onSpawned = (term) => {
      setTerminals((prev) => [...prev, term]);
    };

    const onExit = ({ termId }) => {
      setTerminals((prev) =>
        prev.map((t) => (t.id === termId ? { ...t, status: 'dead' } : t))
      );
    };

    socket.on('terminal:list', onList);
    socket.on('terminal:spawned', onSpawned);
    socket.on('terminal:exit', onExit);

    return () => {
      socket.off('terminal:list', onList);
      socket.off('terminal:spawned', onSpawned);
      socket.off('terminal:exit', onExit);
    };
  }, [socket]);

  const refresh = useCallback(() => {
    terminalApi.list().then(setTerminals).catch(() => {});
  }, []);

  const aliveCount = terminals.filter((t) => t.status === 'alive').length;

  return { terminals, loading, refresh, aliveCount };
}

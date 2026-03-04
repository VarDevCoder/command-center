// Historial de sesiones — buscar y explorar sesiones pasadas
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Search, MessageSquare, Clock } from 'lucide-react';
import { sessionApi } from '../services/api.js';
import Card from '../components/common/Card.jsx';
import { formatDateTime, truncate, timeAgo, projectName } from '../utils/formatters.js';

export default function HistoryPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Cargar sesiones
  useEffect(() => {
    sessionApi.list(100)
      .then((data) => {
        setSessions(data);
        setFiltered(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filtrar por búsqueda
  useEffect(() => {
    if (!search.trim()) {
      setFiltered(sessions);
      return;
    }
    const q = search.toLowerCase();
    setFiltered(
      sessions.filter(
        (s) =>
          s.preview?.toLowerCase().includes(q) ||
          s.project?.toLowerCase().includes(q) ||
          s.sessionId?.toLowerCase().includes(q)
      )
    );
  }, [search, sessions]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-3 bg-bridge-900 border border-bridge-700 rounded-lg px-4 py-2">
        <Search className="w-4 h-4 text-bridge-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar sesiones..."
          className="flex-1 bg-transparent text-sm font-mono text-bridge-200 placeholder-bridge-600
            focus:outline-none"
        />
        <span className="font-mono text-[10px] text-bridge-500">
          {filtered.length} / {sessions.length}
        </span>
      </div>

      {/* Lista de sesiones */}
      <Card title="Session History">
        <div className="divide-y divide-bridge-700/50">
          {loading ? (
            <div className="p-8 text-center font-mono text-sm text-bridge-500">
              Cargando historial...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-bridge-500">
              <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-mono text-sm">
                {search ? 'No hay resultados' : 'No hay sesiones'}
              </p>
            </div>
          ) : (
            filtered.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => navigate(`/history/${session.sessionId}`)}
                className="w-full text-left px-4 py-3 hover:bg-bridge-800/50 transition-colors flex items-center gap-4"
              >
                {/* Icono */}
                <MessageSquare className="w-4 h-4 text-cyan-glow flex-shrink-0" />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-bridge-200 truncate font-mono">
                    {truncate(session.preview, 80) || 'Sin preview'}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-bridge-500">
                    <span>{projectName(session.project)}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(session.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Timestamp */}
                <span className="font-mono text-[10px] text-bridge-600 flex-shrink-0">
                  {formatDateTime(session.timestamp)}
                </span>
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

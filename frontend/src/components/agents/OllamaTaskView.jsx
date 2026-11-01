// Vista de los turnos (tool calls + resultados) de una tarea Ollama.
// El estado de revisión/PR/escalamiento vive en SupervisedTaskView, que se
// muestra junto a este componente (ver AgentDetailPage.jsx).
import { useState, useEffect, useRef } from 'react';
import { ollamaApi } from '../../services/api.js';
import { useSocket } from '../../context/SocketContext.jsx';

export default function OllamaTaskView({ taskId }) {
  const { socket } = useSocket();
  const [turns, setTurns] = useState([]);
  const [worktreePath, setWorktreePath] = useState(null);
  const [branch, setBranch] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    ollamaApi.get(taskId).then((t) => {
      setTurns(t.turns || []);
      setWorktreePath(t.worktreePath);
      setBranch(t.branch);
    }).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    if (!socket) return;

    const onTurn = (payload) => {
      if (payload.taskId !== taskId) return;
      setTurns((prev) => [...prev, { turn: payload.turn, toolCall: payload.toolCall, result: null, timestamp: payload.timestamp }]);
    };
    const onToolResult = (payload) => {
      if (payload.taskId !== taskId) return;
      setTurns((prev) =>
        prev.map((t) => (t.turn === payload.turn ? { ...t, result: payload.result } : t))
      );
    };

    socket.on('ollama:turn', onTurn);
    socket.on('ollama:toolResult', onToolResult);

    return () => {
      socket.off('ollama:turn', onTurn);
      socket.off('ollama:toolResult', onToolResult);
    };
  }, [socket, taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-bridge-900 border border-bridge-700 rounded-lg p-4 space-y-3">
      {worktreePath && (
        <p className="font-mono text-[10px] text-bridge-500 break-all">
          worktree: {worktreePath} · rama: {branch}
        </p>
      )}

      {turns.map((t) => (
        <div key={t.turn} className="space-y-1">
          <div className="max-w-[85%] px-3 py-2 rounded-lg text-xs font-mono bg-bridge-800 border border-bridge-700 text-bridge-200">
            <span className="text-cyan-glow">turno {t.turn} · {t.toolCall?.tool}</span>
            {t.toolCall?.path && <div className="text-bridge-400 mt-1">path: {t.toolCall.path}</div>}
            {t.toolCall?.command && <div className="text-bridge-400 mt-1">$ {t.toolCall.command}</div>}
            {t.toolCall?.summary && <div className="text-bridge-300 mt-1">{t.toolCall.summary}</div>}
          </div>
          {t.result && (
            <div className="max-w-[85%] ml-4 px-3 py-2 rounded-lg text-xs font-mono bg-bridge-950 border border-bridge-800 text-bridge-500 whitespace-pre-wrap">
              {t.result}
            </div>
          )}
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}

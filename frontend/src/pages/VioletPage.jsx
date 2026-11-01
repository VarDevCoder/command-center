// Chat con Violet — coordinadora personal (cerebro: Codex / cuenta ChatGPT)
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { violetApi } from '../services/api.js';
import { useSocket } from '../context/SocketContext.jsx';
import Card from '../components/common/Card.jsx';
import VioletAvatar from '../components/common/VioletAvatar.jsx';
import toast from 'react-hot-toast';

const DRAFT_KEY = 'violet-draft';

export default function VioletPage() {
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [sending, setSending] = useState(false);
  const [toolCall, setToolCall] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    try {
      if (input) localStorage.setItem(DRAFT_KEY, input);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // localStorage no disponible — el borrador simplemente no persiste
    }
  }, [input]);

  useEffect(() => {
    violetApi.history().then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.role === 'violet') setToolCall(null);
    };
    const onToolCall = (payload) => setToolCall(payload);

    socket.on('violet:message', onMessage);
    socket.on('violet:toolCall', onToolCall);
    return () => {
      socket.off('violet:message', onMessage);
      socket.off('violet:toolCall', onToolCall);
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setToolCall(null);
    try {
      await violetApi.chat(text);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
      setToolCall(null);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bridge-700">
          <Link to="/violet/profile" className="flex w-full items-center gap-3 rounded-lg hover:text-purple-glow focus-visible:outline-2 focus-visible:outline-purple-glow" aria-label="Ver perfil de Violet">
            <VioletAvatar />
            <div>
              <p className="font-mono text-sm text-bridge-200">Violet</p>
              <p className="text-[10px] text-bridge-500">Codex · cuenta ChatGPT</p>
            </div>
            <span className="ml-auto text-xs text-purple-glow">Ver perfil</span>
          </Link>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-center text-bridge-500 text-sm mt-8">
              Empezá la conversación con Violet
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'ml-auto bg-cyan-glow/10 border border-cyan-glow/30 text-bridge-100'
                  : 'bg-bridge-800 border border-bridge-700 text-bridge-200'
              }`}
            >
              {m.text}
            </div>
          ))}
          {sending && toolCall && (
            <div className="bg-purple-glow/10 border border-purple-glow/30 text-purple-glow text-xs px-3 py-2 rounded-lg max-w-[80%] font-mono">
              {toolCall.tool === 'read_repo' && `Leyendo ${toolCall.args.repo}${toolCall.args.path && toolCall.args.path !== '.' ? '/' + toolCall.args.path : ''}...`}
              {toolCall.tool === 'launch_agent' && `Lanzando agente ${toolCall.args.provider} en ${toolCall.args.repo}...`}
              {!['read_repo', 'launch_agent'].includes(toolCall.tool) && `Usando herramienta ${toolCall.tool}...`}
            </div>
          )}
          {sending && !toolCall && (
            <div className="bg-bridge-800 border border-bridge-700 text-bridge-500 text-sm px-3 py-2 rounded-lg max-w-[80%] font-mono">
              Violet está escribiendo...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-bridge-700">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribile a Violet..."
            disabled={sending}
            className="flex-1 bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
              text-sm text-bridge-200 focus:outline-none focus:border-cyan-glow/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-4 py-2 rounded-lg bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
              hover:bg-cyan-glow/20 disabled:opacity-30 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </Card>
    </div>
  );
}

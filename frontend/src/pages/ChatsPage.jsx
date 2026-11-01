// Apartado Chats — hablale directamente a Claude, Codex/GPT u Ollama de cada repo
import { useState, useEffect, useRef } from 'react';
import { Send, Folder, MessageSquare, Plus, Sparkles, Cpu, X } from 'lucide-react';
import { chatsApi, projectApi } from '../services/api.js';
import { useSocket } from '../context/SocketContext.jsx';
import { timeAgo } from '../utils/formatters.js';
import toast from 'react-hot-toast';

const PROVIDER_META = {
  claude: { label: 'Claude', icon: Folder, color: 'text-cyan-glow', bg: 'bg-cyan-glow/15', border: 'border-cyan-glow/30' },
  codex: { label: 'Codex / GPT', icon: Sparkles, color: 'text-purple-glow', bg: 'bg-purple-glow/15', border: 'border-purple-glow/30' },
  ollama: { label: 'Ollama', icon: Cpu, color: 'text-green-glow', bg: 'bg-green-glow/15', border: 'border-green-glow/30' },
};

function draftKey(chat) {
  return chat ? `chat-draft::${chat.provider}::${chat.repoDir}` : null;
}

export default function ChatsPage() {
  const { socket } = useSocket();
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [active, setActive] = useState(null); // { repoDir, repoName, provider }
  const [entries, setEntries] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const bottomRef = useRef(null);

  // Persistir el borrador del chat activo para que sobreviva cambios de pestaña
  useEffect(() => {
    const key = draftKey(active);
    if (!key) return;
    try {
      if (input) localStorage.setItem(key, input);
      else localStorage.removeItem(key);
    } catch {
      // localStorage no disponible — el borrador simplemente no persiste
    }
  }, [input, active]);

  useEffect(() => {
    chatsApi.list()
      .then(setChats)
      .catch(() => toast.error('Error cargando chats'))
      .finally(() => setLoadingChats(false));
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (msg) => {
      if (active && msg.repoDir === active.repoDir && msg.provider === active.provider) {
        setEntries((prev) => [...prev, { type: 'assistant', content: msg.text }]);
      }
      setChats((prev) => {
        const idx = prev.findIndex((c) => c.repoDir === msg.repoDir && c.provider === msg.provider);
        if (idx === -1) {
          return [{ repoDir: msg.repoDir, repoName: msg.repoName, fullName: msg.repoName, provider: msg.provider, preview: msg.text, lastActivity: msg.timestamp }, ...prev];
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], preview: msg.text, lastActivity: msg.timestamp };
        return updated.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
      });
    };
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, [socket, active]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const openChat = async (chat) => {
    setActive(chat);
    setEntries([]);
    try {
      setInput(localStorage.getItem(draftKey(chat)) || '');
    } catch {
      setInput('');
    }
    try {
      const history = await chatsApi.history(chat.repoDir, chat.provider);
      setEntries(history.entries || []);
    } catch {
      toast.error('Error cargando historial');
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !active || sending) return;

    setEntries((prev) => [...prev, { type: 'user', content: text }]);
    setInput('');
    setSending(true);
    try {
      await chatsApi.send(active.repoDir, active.repoName, text, active.provider);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleCreated = (chat) => {
    setShowNewChat(false);
    setChats((prev) => {
      const exists = prev.some((c) => c.repoDir === chat.repoDir && c.provider === chat.provider);
      return exists ? prev : [chat, ...prev];
    });
    openChat(chat);
  };

  const activeMeta = active ? PROVIDER_META[active.provider] : null;

  return (
    <div className="flex h-full gap-4">
      {/* Lista de contactos (repo + proveedor) */}
      <div className="w-72 flex-shrink-0 bg-bridge-900 border border-bridge-700 rounded-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bridge-700">
          <h3 className="font-mono text-xs font-semibold text-bridge-300 uppercase tracking-wider">
            Chats
          </h3>
          <button
            onClick={() => setShowNewChat(true)}
            className="p-1 rounded hover:bg-bridge-800 text-bridge-400 hover:text-cyan-glow transition-colors"
            title="Nuevo chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {loadingChats && (
            <p className="px-4 py-6 text-center font-mono text-xs text-bridge-500">Cargando...</p>
          )}
          {!loadingChats && chats.length === 0 && (
            <p className="px-4 py-6 text-center font-mono text-xs text-bridge-500">
              Sin conversaciones todavía
            </p>
          )}
          {chats.map((chat) => {
            const meta = PROVIDER_META[chat.provider] || PROVIDER_META.claude;
            const Icon = meta.icon;
            const isActive = active?.repoDir === chat.repoDir && active?.provider === chat.provider;
            return (
              <button
                key={`${chat.provider}::${chat.repoDir}`}
                onClick={() => openChat(chat)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-bridge-800/60
                  hover:bg-bridge-800/60 transition-colors ${isActive ? 'bg-bridge-800' : ''}`}
              >
                <div className={`w-8 h-8 rounded-full ${meta.bg} border ${meta.border} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-bridge-200 truncate">
                    {chat.repoName} <span className={`text-[10px] ${meta.color}`}>· {meta.label}</span>
                  </p>
                  <p className="text-xs text-bridge-500 truncate">{chat.preview || '—'}</p>
                </div>
                <span className="text-[10px] font-mono text-bridge-600 flex-shrink-0">
                  {timeAgo(chat.lastActivity)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel de conversación */}
      <div className="flex-1 bg-bridge-900 border border-bridge-700 rounded-lg flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-bridge-500">
            <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
            <p className="font-mono text-sm">Elegí un chat de la izquierda o creá uno nuevo</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-bridge-700">
              <p className="font-mono text-sm text-bridge-200">{active.repoName}</p>
              <div className="flex gap-1.5 mt-2">
                {Object.entries(PROVIDER_META).map(([key, meta]) => {
                  const Icon = meta.icon;
                  const isSelected = active.provider === key;
                  return (
                    <button
                      key={key}
                      onClick={() => openChat({ repoDir: active.repoDir, repoName: active.repoName, provider: key })}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono border transition-colors ${
                        isSelected ? `${meta.bg} ${meta.border} ${meta.color}` : 'bg-bridge-950 border-bridge-700 text-bridge-500 hover:text-bridge-300'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {entries.map((e, i) => (
                <ChatEntry key={i} entry={e} />
              ))}
              {sending && (
                <div className="bg-bridge-800 border border-bridge-700 text-bridge-500 text-sm px-3 py-2 rounded-lg max-w-[80%] font-mono">
                  Escribiendo...
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-bridge-700">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Escribile al ${activeMeta.label} de ${active.repoName}...`}
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
          </>
        )}
      </div>

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} onSend={handleCreated} />
      )}
    </div>
  );
}

function NewChatModal({ onClose, onSend }) {
  const [projects, setProjects] = useState([]);
  const [repoDir, setRepoDir] = useState('');
  const [repoName, setRepoName] = useState('');
  const [provider, setProvider] = useState('claude');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    projectApi.list().then((data) => {
      const cloned = data.filter((p) => p.clonedLocally);
      setProjects(cloned);
      if (cloned.length > 0) {
        setRepoDir(cloned[0].dir);
        setRepoName(cloned[0].name);
      }
    }).catch(() => toast.error('Error cargando repos'));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!repoDir || !text.trim()) return;
    setSending(true);
    try {
      const reply = await chatsApi.send(repoDir, repoName, text.trim(), provider);
      onSend({ repoDir, repoName, provider, preview: reply.text, lastActivity: reply.timestamp });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-bridge-900 border border-bridge-700 rounded-lg w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm text-bridge-200">Nuevo chat</h3>
          <button onClick={onClose} className="text-bridge-500 hover:text-bridge-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">Repo</label>
            <select
              value={repoDir}
              onChange={(e) => {
                setRepoDir(e.target.value);
                setRepoName(projects.find((p) => p.dir === e.target.value)?.name || '');
              }}
              className="w-full bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2 text-sm text-bridge-200"
            >
              {projects.map((p) => (
                <option key={p.dir} value={p.dir}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">Proveedor</label>
            <div className="flex gap-2">
              {Object.entries(PROVIDER_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProvider(key)}
                  className={`flex-1 py-2 px-2 rounded-lg font-mono text-xs border transition-colors ${
                    provider === key ? `${meta.bg} ${meta.border} ${meta.color}` : 'bg-bridge-950 border-bridge-700 text-bridge-400'
                  }`}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">Primer mensaje</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Escribí tu mensaje..."
              className="w-full bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2 text-sm text-bridge-200 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={sending || !text.trim() || !repoDir}
            className="w-full py-2 rounded-lg bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
              hover:bg-cyan-glow/20 disabled:opacity-30 font-mono text-sm transition-colors"
          >
            {sending ? 'Enviando...' : 'Iniciar chat'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatEntry({ entry }) {
  if (entry.type === 'user') {
    return (
      <div className="ml-auto max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap
        bg-cyan-glow/10 border border-cyan-glow/30 text-bridge-100">
        {entry.content}
      </div>
    );
  }
  if (entry.type === 'assistant') {
    return (
      <div className="max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap
        bg-bridge-800 border border-bridge-700 text-bridge-200">
        {entry.content}
      </div>
    );
  }
  if (entry.type === 'tool_use') {
    return (
      <div className="max-w-[80%] px-3 py-1.5 rounded-lg text-xs font-mono text-bridge-500
        bg-bridge-800/40 border border-bridge-700/60">
        {entry.toolName}: {entry.content}
      </div>
    );
  }
  return null;
}

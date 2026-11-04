// Chat con Violet — coordinadora personal (cerebro: Codex / cuenta ChatGPT)
import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, Send, X } from 'lucide-react';
import { violetApi } from '../services/api.js';
import { useSocket } from '../context/SocketContext.jsx';
import Card from '../components/common/Card.jsx';
import VioletAvatar from '../components/common/VioletAvatar.jsx';
import VioletAvatarFallback from '../components/violet/VioletAvatarFallback.jsx';
import toast from 'react-hot-toast';

const VioletAvatar3D = lazy(() =>
  import('../components/violet/VioletAvatar3D.jsx').catch(() => ({ default: VioletAvatarFallback }))
);

const GREETING_MS = 4000;
const TALKING_MS_PER_CHAR = 60;
const TALKING_MIN_MS = 1500;
const TALKING_MAX_MS = 12000;
const DRAFT_KEY = 'violet-draft';
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const preview = String(reader.result);
      resolve({
        id: `${file.name}-${file.lastModified}-${file.size}-${Math.random()}`,
        name: file.name,
        mimeType: file.type,
        data: preview.split(',')[1],
        preview,
      });
    };
    reader.onerror = () => reject(new Error(`No pude leer ${file.name}`));
    reader.readAsDataURL(file);
  });
}

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
  const [images, setImages] = useState([]);
  const [toolCall, setToolCall] = useState(null);
  const [greeting, setGreeting] = useState(true);
  const [talking, setTalking] = useState(false);
  const talkingTimerRef = useRef(null);
  const greetingTimerRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  let avatarState = 'idle';
  if (sending) avatarState = 'thinking';
  else if (talking) avatarState = 'talking';
  else if (greeting) avatarState = 'greeting';
  else if (input.trim()) avatarState = 'listening';

  // El saludo cuenta desde que el modelo cargó: si no, se consume durante la descarga y no se ve.
  const handleAvatarLoadEnd = () => {
    clearTimeout(greetingTimerRef.current);
    greetingTimerRef.current = setTimeout(() => setGreeting(false), GREETING_MS);
  };

  useEffect(() => () => {
    clearTimeout(talkingTimerRef.current);
    clearTimeout(greetingTimerRef.current);
  }, []);

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
      if (msg.role !== 'violet') return;
      setToolCall(null);
      const duration = Math.min(
        Math.max((msg.text?.length || 0) * TALKING_MS_PER_CHAR, TALKING_MIN_MS),
        TALKING_MAX_MS
      );
      clearTimeout(talkingTimerRef.current);
      setTalking(true);
      talkingTimerRef.current = setTimeout(() => setTalking(false), duration);
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
    if ((!text && images.length === 0) || sending) return;

    const pendingImages = images;
    setInput('');
    setImages([]);
    setSending(true);
    setToolCall(null);
    try {
      await violetApi.chat(text, pendingImages.map(({ name, mimeType, data }) => ({ name, mimeType, data })));
    } catch (err) {
      setInput(text);
      setImages(pendingImages);
      toast.error(err.message);
    } finally {
      setSending(false);
      setToolCall(null);
    }
  };

  const addImages = async (files) => {
    const available = 4 - images.length;
    if (available <= 0) return toast.error('Podés adjuntar hasta 4 imágenes');

    const selected = files.slice(0, available);
    const invalid = selected.find((file) => !ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES);
    if (invalid) return toast.error(`${invalid.name}: usá PNG, JPG, WebP o GIF de hasta 8 MB`);

    try {
      const loadedImages = await Promise.all(selected.map(readImage));
      setImages((current) => [...current, ...loadedImages]);
      if (files.length > available) toast.error('Podés adjuntar hasta 4 imágenes');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleImages = async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    await addImages(files);
  };

  const handlePaste = async (event) => {
    const pastedImages = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    await addImages(pastedImages);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full max-w-6xl mx-auto">
      <aside
        aria-label="Avatar 3D de Violet"
        className="shrink-0 h-56 w-full lg:order-last lg:h-auto lg:w-96 lg:aspect-square lg:self-start overflow-hidden rounded-lg border border-bridge-700 bg-bridge-900"
      >
        <Suspense fallback={<p className="flex h-full items-center justify-center text-[10px] font-mono text-bridge-500">Cargando avatar...</p>}>
          <VioletAvatar3D state={avatarState} onLoadEnd={handleAvatarLoadEnd} />
        </Suspense>
      </aside>
      <Card className="flex-1 flex flex-col min-h-0 min-w-0">
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
              {m.attachments?.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {m.attachments.map((attachment) => (
                    <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer">
                      <img src={attachment.url} alt={attachment.name} className="max-h-56 w-full rounded-md object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {m.text}
            </div>
          ))}
          {sending && toolCall && (
            <div className="bg-purple-glow/10 border border-purple-glow/30 text-purple-glow text-xs px-3 py-2 rounded-lg max-w-[80%] font-mono">
              {toolCall.tool === 'read_repo' && `Leyendo ${toolCall.args.repo}${toolCall.args.path && toolCall.args.path !== '.' ? '/' + toolCall.args.path : ''}...`}
              {toolCall.tool === 'launch_agent' && `Lanzando agente ${toolCall.args.provider} en ${toolCall.args.dir || toolCall.args.repo}...`}
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

        <form onSubmit={handleSend} className="p-3 border-t border-bridge-700">
          {images.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-3">
              {images.map((image) => (
                <div key={image.id} className="relative shrink-0">
                  <img src={image.preview} alt={image.name} className="h-20 w-20 rounded-lg border border-bridge-700 object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                    className="absolute -right-1 -top-1 rounded-full bg-bridge-950 p-1 text-bridge-300 hover:text-white"
                    aria-label={`Quitar ${image.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={handleImages}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || images.length >= 4}
            className="px-3 py-2 rounded-lg border border-bridge-700 text-bridge-300 hover:border-purple-glow/50 hover:text-purple-glow disabled:opacity-30 transition-colors"
            aria-label="Adjuntar imágenes"
            title="Adjuntar imágenes"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setGreeting(false);
            }}
            onPaste={handlePaste}
            placeholder="Escribile o pegá una imagen con Ctrl+V..."
            disabled={sending}
            className="flex-1 bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
              text-sm text-bridge-200 focus:outline-none focus:border-cyan-glow/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && images.length === 0)}
            className="px-4 py-2 rounded-lg bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
              hover:bg-cyan-glow/20 disabled:opacity-30 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

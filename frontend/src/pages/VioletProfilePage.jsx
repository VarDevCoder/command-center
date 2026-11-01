import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Expand, MessageCircle, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import Card from '../components/common/Card.jsx';
import VioletAvatar from '../components/common/VioletAvatar.jsx';

export default function VioletProfilePage() {
  const imageDialog = useRef(null);
  const [zoom, setZoom] = useState(1);

  const openImage = () => {
    setZoom(1);
    imageDialog.current?.showModal();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/violet" className="inline-flex items-center gap-2 text-sm text-bridge-400 hover:text-bridge-100">
        <ArrowLeft className="h-4 w-4" />
        Volver al chat
      </Link>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-5 p-6">
          <button type="button" onClick={openImage} aria-label="Ampliar foto de perfil de Violet" className="rounded-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-purple-glow">
            <VioletAvatar className="h-24 w-24" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-bridge-100">Violet</h1>
            <p className="mt-1 text-sm text-purple-glow">Coordinadora de ingeniería · SoluNet</p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-bridge-400">
              Tu asistente personal y colaboradora estratégica para organizar proyectos,
              resolver bloqueos y llevar las ideas a resultados concretos.
            </p>
          </div>
        </div>

        <div className="border-t border-bridge-700 px-6 py-4">
          <Link to="/violet" className="inline-flex items-center gap-2 rounded-lg border border-purple-glow/30 bg-purple-glow/10 px-4 py-2 text-sm text-purple-glow hover:bg-purple-glow/20">
            <MessageCircle className="h-4 w-4" />
            Chatear con Violet
          </Link>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <button type="button" onClick={openImage} aria-label="Abrir imagen completa de Violet" className="group block w-full cursor-zoom-in text-left focus-visible:outline-2 focus-visible:outline-purple-glow">
          <img src="/violet-profile.png" alt="Violet en su centro de coordinación de proyectos" className="block h-auto w-full" />
          <span className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-bridge-300 group-hover:text-purple-glow">
            Foto de perfil
            <span className="inline-flex items-center gap-2"><Expand className="h-4 w-4" />Ampliar imagen</span>
          </span>
        </button>
      </Card>

      <dialog
        ref={imageDialog}
        aria-labelledby="violet-image-title"
        className="fixed inset-0 m-auto h-[90dvh] max-h-[90dvh] w-[94vw] max-w-7xl overflow-hidden rounded-xl border border-bridge-600 bg-bridge-950 p-0 text-bridge-200 backdrop:bg-black/85"
        onClick={(event) => {
          if (event.target === event.currentTarget) imageDialog.current?.close();
        }}
        onClose={() => setZoom(1)}
      >
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-bridge-700 p-3">
            <h2 id="violet-image-title" className="mr-auto font-mono text-sm">Violet</h2>
            <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={zoom === 1} aria-label="Reducir imagen" className="rounded-lg p-2 hover:bg-bridge-700 disabled:opacity-30">
              <ZoomOut className="h-5 w-5" />
            </button>
            <span className="w-12 text-center text-xs font-mono" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.5))} disabled={zoom === 3} aria-label="Aumentar imagen" className="rounded-lg p-2 hover:bg-bridge-700 disabled:opacity-30">
              <ZoomIn className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Ajustar imagen a la ventana" title="Ajustar a la ventana" className="rounded-lg p-2 hover:bg-bridge-700">
              <RotateCcw className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => imageDialog.current?.close()} aria-label="Cerrar imagen" autoFocus className="rounded-lg p-2 hover:bg-bridge-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain" tabIndex={0} aria-label="Imagen de Violet; usá las barras de desplazamiento al ampliar">
            <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img src="/violet-profile.png" alt="Imagen completa de Violet" draggable={false} className="block h-full w-full object-contain" />
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

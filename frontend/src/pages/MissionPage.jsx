// Mission Control — Lanzar nuevos agentes
import { useState, useEffect, useRef } from 'react';
import { Rocket, Lock, Globe, Download, HardDrive, RefreshCw } from 'lucide-react';
import { agentApi, projectApi } from '../services/api.js';
import Card from '../components/common/Card.jsx';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

// Misiones rápidas pre-configuradas
const QUICK_MISSIONS = [
  { label: 'Run Tests', prompt: 'Run all tests and report results', icon: '🧪' },
  { label: 'Git Status', prompt: 'Show git status, recent commits, and any uncommitted changes', icon: '📊' },
  { label: 'Build Check', prompt: 'Run the build command and report if it succeeds or fails', icon: '🔨' },
  { label: 'Lint & Fix', prompt: 'Run linting and fix any auto-fixable issues', icon: '✨' },
  { label: 'Dep Audit', prompt: 'Check for outdated or vulnerable dependencies', icon: '🔒' },
  { label: 'DB Status', prompt: 'Check database connection and run pending migrations if any', icon: '🗄️' },
];

// Proveedores disponibles para lanzar agentes
const PROVIDERS = {
  claude: { label: 'Claude', models: ['haiku', 'sonnet', 'opus'], efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  codex: { label: 'Codex / GPT', models: ['gpt-5.4'], efforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
  ollama: { label: 'Ollama (local)', models: ['qwen2.5-coder:7b', 'qwen2.5vl:7b', 'qwen2.5vl:32b'], efforts: null },
};

// Misma heurística que el backend (gitSupervision.js::looksLikeModification)
// — solo para mostrar el aviso antes de enviar, el backend decide de verdad.
const MODIFY_KEYWORDS = /\b(arregl\w*|implement\w*|agreg\w*|a[ñn]ad\w*|modific\w*|refactoriz\w*|elimin\w*|borr\w*|cre\w*|instal\w*|actualiz\w*|cambi\w*|corrig\w*|escrib\w*|mov\w*|renombr\w*|sobreescrib\w*|configur\w*|despleg\w*|optimiz\w*|limpi\w*)\w*\b/i;

function looksLikeModification(prompt) {
  return MODIFY_KEYWORDS.test(prompt || '');
}

export default function MissionPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [form, setForm] = useState({
    repo: '',
    provider: 'claude',
    model: 'sonnet',
    effort: '',
    prompt: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [scan, setScan] = useState({ status: 'idle', reposFound: 0 });
  const pollRef = useRef(null);

  const loadProjects = () => {
    projectApi.list()
      .then((data) => {
        setProjects(data);
        setForm((prev) => (prev.repo ? prev : { ...prev, repo: data[0]?.fullName || '' }));
      })
      .catch(() => toast.error('Error cargando repos de GitHub'))
      .finally(() => setLoadingProjects(false));
  };

  const pollScan = () => {
    clearTimeout(pollRef.current);
    projectApi.scanStatus().then((s) => {
      setScan(s);
      if (s.status === 'scanning') {
        pollRef.current = setTimeout(pollScan, 3000);
      } else {
        loadProjects(); // el escaneo terminó: refrescar qué está clonado
      }
    }).catch(() => {});
  };

  // Cargar lista de repos desde GitHub + seguir el escaneo de disco en background
  useEffect(() => {
    loadProjects();
    pollScan();
    return () => clearTimeout(pollRef.current);
  }, []);

  const handleRescan = () => {
    setScan((prev) => ({ ...prev, status: 'scanning' }));
    projectApi.rescan().then(pollScan);
  };

  const selectedProject = projects.find((p) => p.fullName === form.repo);

  const handleProviderChange = (provider) => {
    setForm((prev) => ({
      ...prev,
      provider,
      model: PROVIDERS[provider].models[0],
      effort: '',
    }));
  };

  // Asegura que el repo esté clonado localmente y devuelve su directorio
  const resolveProjectDir = async () => {
    if (!selectedProject) throw new Error('Selecciona un repo primero');
    if (selectedProject.clonedLocally) return selectedProject.dir;

    const cloning = toast.loading(`Clonando ${selectedProject.name}...`);
    try {
      const { dir } = await projectApi.clone({
        fullName: selectedProject.fullName,
        name: selectedProject.name,
      });
      toast.success(`${selectedProject.name} clonado`, { id: cloning });
      setProjects((prev) =>
        prev.map((p) => (p.fullName === selectedProject.fullName ? { ...p, clonedLocally: true } : p))
      );
      return dir;
    } catch (err) {
      toast.error(`No se pudo clonar: ${err.message}`, { id: cloning });
      throw err;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.prompt.trim() || !form.repo) return;

    setSubmitting(true);
    try {
      const projectDir = await resolveProjectDir();
      const agent = await agentApi.spawn({
        prompt: form.prompt.trim(),
        projectDir,
        provider: form.provider,
        model: form.model,
        effort: form.effort || undefined,
        repoFullName: selectedProject?.fullName,
      });
      toast.success('Agente lanzado');
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      if (err.message) toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickMission = async (mission) => {
    if (!form.repo) {
      toast.error('Selecciona un repo primero');
      return;
    }

    setSubmitting(true);
    try {
      const projectDir = await resolveProjectDir();
      const agent = await agentApi.spawn({
        prompt: mission.prompt,
        projectDir,
        provider: 'claude',
        model: 'haiku',
        repoFullName: selectedProject?.fullName,
      });
      toast.success(`Misión "${mission.label}" lanzada`);
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      if (err.message) toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
      {/* Formulario principal */}
      <div className="xl:col-span-2">
      <Card title="Launch New Agent" action={
        scan.status === 'scanning' ? (
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-bridge-500">
            <HardDrive className="w-3 h-3 animate-pulse" />
            Escaneando disco... ({scan.reposFound} encontrados)
          </span>
        ) : (
          <button
            type="button"
            onClick={handleRescan}
            className="flex items-center gap-1.5 text-[10px] font-mono text-bridge-500 hover:text-cyan-glow transition-colors"
            title="Re-escanear el disco en busca de repos clonados"
          >
            <RefreshCw className="w-3 h-3" />
            {scan.reposFound} repos locales
          </button>
        )
      }>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Proyecto (repo de GitHub) */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Repository
            </label>
            <select
              value={form.repo}
              onChange={(e) => setForm({ ...form, repo: e.target.value })}
              disabled={loadingProjects}
              className="w-full bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
                text-sm font-mono text-bridge-200 focus:outline-none focus:border-cyan-glow/50
                disabled:opacity-50"
            >
              {loadingProjects && <option>Cargando repos de GitHub...</option>}
              {!loadingProjects && projects.length === 0 && <option>Sin repos encontrados</option>}
              {projects.map((p) => (
                <option key={p.fullName} value={p.fullName}>
                  {p.name} {p.isPrivate ? '🔒' : ''} {p.clonedLocally ? '' : '(sin clonar)'}
                </option>
              ))}
            </select>
          </div>

          {/* Proveedor */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Provider
            </label>
            <div className="flex gap-2">
              {Object.entries(PROVIDERS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleProviderChange(key)}
                  className={`flex-1 py-2 px-3 rounded-lg font-mono text-sm border transition-colors ${
                    form.provider === key
                      ? 'bg-cyan-glow/10 border-cyan-glow/50 text-cyan-glow'
                      : 'bg-bridge-950 border-bridge-700 text-bridge-400 hover:border-bridge-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {form.provider === 'ollama' && (
              <p className="text-[10px] text-amber-glow mt-1.5">
                Ollama siempre corre en modo protegido: worktree aislado + revisión obligatoria de Claude antes de poder mergearse.
              </p>
            )}
          </div>

          {/* Modelo */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Model
            </label>
            <div className="flex gap-2 flex-wrap">
              {PROVIDERS[form.provider].models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm({ ...form, model: m })}
                  className={`flex-1 py-2 px-3 rounded-lg font-mono text-sm border transition-colors ${
                    form.model === m
                      ? 'bg-cyan-glow/10 border-cyan-glow/50 text-cyan-glow'
                      : 'bg-bridge-950 border-bridge-700 text-bridge-400 hover:border-bridge-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Effort (solo si el proveedor lo soporta) */}
          {PROVIDERS[form.provider].efforts && (
            <div>
              <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
                Effort
              </label>
              <div className="flex gap-2 flex-wrap">
                {PROVIDERS[form.provider].efforts.map((ef) => (
                  <button
                    key={ef}
                    type="button"
                    onClick={() => setForm({ ...form, effort: form.effort === ef ? '' : ef })}
                    className={`flex-1 py-1.5 px-2 rounded-lg font-mono text-xs border transition-colors ${
                      form.effort === ef
                        ? 'bg-purple-glow/10 border-purple-glow/50 text-purple-glow'
                        : 'bg-bridge-950 border-bridge-700 text-bridge-400 hover:border-bridge-600'
                    }`}
                  >
                    {ef}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Mission Brief
            </label>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Describe la misión para el agente..."
              rows={5}
              className="w-full bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
                text-sm font-mono text-green-glow placeholder-bridge-600
                focus:outline-none focus:border-cyan-glow/50 resize-none"
            />
            {form.provider !== 'ollama' && looksLikeModification(form.prompt) && (
              <p className="text-[10px] text-amber-glow mt-1.5">
                Este prompt activará el modo protegido: rama aislada + revisión + Pull Request antes de poder mergearse.
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !form.prompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg
              bg-cyan-glow/10 text-cyan-glow border border-cyan-glow/30
              hover:bg-cyan-glow/20 disabled:opacity-30 disabled:cursor-not-allowed
              font-mono text-sm font-semibold transition-colors"
          >
            <Rocket className="w-4 h-4" />
            {submitting ? 'LAUNCHING...' : 'LAUNCH AGENT'}
          </button>
        </form>
      </Card>
      </div>

      {/* Columna lateral: proyecto seleccionado + misiones rápidas */}
      <div className="space-y-6">
        <Card title="Project Info">
          <div className="p-4 space-y-2">
            {selectedProject ? (
              <>
                <p className="font-mono text-sm text-cyan-glow truncate">{selectedProject.fullName}</p>
                {selectedProject.description && (
                  <p className="text-xs text-bridge-400">{selectedProject.description}</p>
                )}
                <p className="font-mono text-[11px] text-bridge-500 break-all">{selectedProject.dir}</p>
                <div className="flex gap-2 pt-2 flex-wrap">
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-bridge-800 border border-bridge-700 text-[10px] font-mono text-bridge-300">
                    {selectedProject.isPrivate ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                    {selectedProject.isPrivate ? 'Private' : 'Public'}
                  </span>
                  <span className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-mono ${
                    selectedProject.clonedLocally
                      ? 'bg-bridge-800 border-bridge-700 text-bridge-300'
                      : 'bg-amber-glow/10 border-amber-glow/30 text-amber-glow'
                  }`}>
                    {!selectedProject.clonedLocally && <Download className="w-3 h-3" />}
                    {selectedProject.clonedLocally ? 'Cloned' : 'Not cloned yet'}
                  </span>
                </div>
              </>
            ) : (
              <p className="font-mono text-xs text-bridge-500">Selecciona un repo</p>
            )}
          </div>
        </Card>

        <Card title="Quick Missions">
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
            {QUICK_MISSIONS.map((mission) => (
              <button
                key={mission.label}
                onClick={() => handleQuickMission(mission)}
                disabled={submitting}
                className="flex items-center gap-2 px-3 py-3 rounded-lg
                  bg-bridge-800 border border-bridge-700 text-bridge-300
                  hover:border-bridge-600 hover:bg-bridge-700/50
                  disabled:opacity-30 transition-colors text-left"
              >
                <span className="text-lg">{mission.icon}</span>
                <div className="min-w-0">
                  <p className="font-mono text-xs font-medium">{mission.label}</p>
                  <p className="text-[10px] text-bridge-500 mt-0.5 line-clamp-1">
                    {mission.prompt}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// Mission Control — Lanzar nuevos agentes
import { useState, useEffect } from 'react';
import { Rocket, Zap } from 'lucide-react';
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

export default function MissionPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    projectDir: '',
    model: 'sonnet',
    prompt: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Cargar lista de proyectos
  useEffect(() => {
    projectApi.list()
      .then((data) => {
        setProjects(data);
        if (data.length > 0) {
          setForm((prev) => ({ ...prev, projectDir: data[0].dir }));
        }
      })
      .catch(() => toast.error('Error cargando proyectos'));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.prompt.trim() || !form.projectDir) return;

    setSubmitting(true);
    try {
      const agent = await agentApi.spawn({
        prompt: form.prompt.trim(),
        projectDir: form.projectDir,
        model: form.model,
      });
      toast.success('Agente lanzado');
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickMission = async (mission) => {
    if (!form.projectDir) {
      toast.error('Selecciona un proyecto primero');
      return;
    }

    setSubmitting(true);
    try {
      const agent = await agentApi.spawn({
        prompt: mission.prompt,
        projectDir: form.projectDir,
        model: 'haiku',
      });
      toast.success(`Misión "${mission.label}" lanzada`);
      navigate(`/agent/${agent.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Formulario principal */}
      <Card title="Launch New Agent">
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Proyecto */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Project
            </label>
            <select
              value={form.projectDir}
              onChange={(e) => setForm({ ...form, projectDir: e.target.value })}
              className="w-full bg-bridge-950 border border-bridge-700 rounded-lg px-3 py-2
                text-sm font-mono text-bridge-200 focus:outline-none focus:border-cyan-glow/50"
            >
              {projects.map((p) => (
                <option key={p.dir} value={p.dir}>
                  {p.name} {p.hasBackend ? '📦' : ''} {p.hasFrontend ? '🎨' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Modelo */}
          <div>
            <label className="block font-mono text-xs text-bridge-400 mb-1.5 uppercase tracking-wider">
              Model
            </label>
            <div className="flex gap-2">
              {['haiku', 'sonnet', 'opus'].map((m) => (
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

      {/* Misiones rápidas */}
      <Card title="Quick Missions">
        <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-3">
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
              <div>
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
  );
}

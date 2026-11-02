import { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, CircleDollarSign, ExternalLink, RefreshCw, Square, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import Card from '../components/common/Card.jsx';
import { usageApi, vscodeAgentApi } from '../services/api.js';
import { timeAgo } from '../utils/formatters.js';

const number = new Intl.NumberFormat('es-PY');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function OperationsPage() {
  const [sessions, setSessions] = useState([]);
  const [usage, setUsage] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [sessionResult, usageResult] = await Promise.allSettled([vscodeAgentApi.list(), usageApi.summary(days)]);
    if (sessionResult.status === 'fulfilled') setSessions(sessionResult.value);
    else toast.error(sessionResult.reason.message);
    if (usageResult.status === 'fulfilled') setUsage(usageResult.value);
    else toast.error(usageResult.reason.message);
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const stop = async (session) => {
    try { await vscodeAgentApi.stop(session.uri); toast.success('Turno cancelado'); await load(); }
    catch (err) { toast.error(err.message); }
  };

  const open = async (session) => {
    try { await vscodeAgentApi.open(session.workspace); toast.success('Proyecto abierto en Agents'); }
    catch (err) { toast.error(err.message); }
  };

  const active = sessions.filter((session) => session.active).length;

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-xl text-bridge-100 font-semibold">VS Code Agents & consumo</h1><p className="text-xs text-bridge-500 mt-1">Control operativo y costo API equivalente</p></div>
      <button onClick={load} disabled={loading} className="p-2 rounded-lg border border-bridge-700 text-bridge-400 hover:text-cyan-glow disabled:opacity-40" title="Actualizar"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Metric icon={Activity} label="Activas" value={active} color="text-green-glow" />
      <Metric icon={Bot} label="Sesiones VS Code" value={sessions.length} color="text-purple-glow" />
      <Metric icon={Zap} label={`Tokens · ${days}d`} value={compactTokens(usage)} color="text-cyan-glow" />
      <Metric icon={CircleDollarSign} label="Equivalente API" value={money.format(usage?.estimatedApiCostUsd || 0)} color="text-amber-glow" />
    </div>

    <Card title="Consumo por proveedor" action={<select value={days} onChange={(event) => setDays(Number(event.target.value))} className="bg-bridge-900 border border-bridge-700 rounded px-2 py-1 text-xs text-bridge-300"><option value={7}>7 días</option><option value={30}>30 días</option><option value={90}>90 días</option></select>}>
      <div className="grid md:grid-cols-2 gap-4 p-4">
        <UsageProvider title="Claude Code" data={usage?.providers?.claude} accent="border-amber-glow/30" />
        <UsageProvider title="ChatGPT / Codex" data={usage?.providers?.chatgpt} accent="border-purple-glow/30" />
      </div>
      <p className="px-4 pb-4 text-[10px] text-bridge-500">{usage?.note}</p>
    </Card>

    <Card title="Sesiones de VS Code">
      <div className="divide-y divide-bridge-700/60">
        {sessions.length === 0 ? <p className="p-8 text-center text-sm text-bridge-500">No se encontraron sesiones</p> : sessions.map((session) => <div key={session.id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${session.active ? 'bg-green-glow animate-glow' : 'bg-bridge-600'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2"><p className="text-sm text-bridge-200 truncate">{session.title}</p><span className="text-[9px] uppercase font-mono text-bridge-500">{session.status}</span></div>
            <p className="text-[10px] font-mono text-bridge-500 truncate mt-1">{session.workspace || session.id}</p>
            <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-bridge-500"><span>{session.model?.replace('@provider=openai:', '') || session.provider}</span><span>{session.branch || 'sin rama'}</span><span>{number.format(session.usage.inputTokens + session.usage.outputTokens)} tokens</span><span>{timeAgo(session.updatedAt)}</span></div>
          </div>
          <div className="flex gap-2">
            {session.workspace && <button onClick={() => open(session)} className="p-2 border border-bridge-700 rounded text-bridge-400 hover:text-cyan-glow" title="Abrir en Agents"><ExternalLink className="w-4 h-4" /></button>}
            {session.active && <button onClick={() => stop(session)} className="p-2 border border-red-glow/30 rounded text-red-glow" title="Cancelar turno"><Square className="w-4 h-4" /></button>}
          </div>
        </div>)}
      </div>
    </Card>
  </div>;
}

function UsageProvider({ title, data, accent }) {
  return <div className={`rounded-lg border ${accent} bg-bridge-950/50 p-4`}>
    <div className="flex justify-between"><h3 className="text-sm text-bridge-200">{title}</h3><span className="font-mono text-sm text-amber-glow">{money.format(data?.estimatedApiCostUsd || 0)}</span></div>
    <div className="grid grid-cols-2 gap-3 mt-4 text-xs"><Label label="Entrada" value={data?.inputTokens} /><Label label="Cache" value={data?.cachedInputTokens} /><Label label="Salida" value={data?.outputTokens} /><Label label="Sesiones" value={data?.sessions} /></div>
    {data?.rateLimits?.primary && <p className="mt-3 text-[10px] text-bridge-500">Ventana ChatGPT: {data.rateLimits.primary.used_percent}% utilizado</p>}
  </div>;
}

function Label({ label, value = 0 }) { return <div><p className="text-bridge-500">{label}</p><p className="font-mono text-bridge-200 mt-0.5">{number.format(value || 0)}</p></div>; }
function Metric({ icon: Icon, label, value, color }) { return <div className="bg-bridge-900 border border-bridge-700 rounded-lg p-4 flex gap-3 items-center"><Icon className={`w-5 h-5 ${color}`} /><div><p className={`font-mono text-lg font-bold ${color}`}>{value}</p><p className="text-[10px] text-bridge-500 uppercase">{label}</p></div></div>; }
function compactTokens(usage) { const value = Object.values(usage?.providers || {}).reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0); return value > 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : number.format(value); }

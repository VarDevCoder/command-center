// Estilos compartidos para veredictos de revisión (APPROVE/REJECT/FIX-NEEDED/ERROR)
import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';

export const VERDICT_STYLE = {
  APPROVE: { icon: CheckCircle2, color: 'text-green-glow', border: 'border-green-glow/40', bg: 'bg-green-glow/10' },
  REJECT: { icon: XCircle, color: 'text-red-glow', border: 'border-red-glow/40', bg: 'bg-red-glow/10' },
  'FIX-NEEDED': { icon: HelpCircle, color: 'text-amber-glow', border: 'border-amber-glow/40', bg: 'bg-amber-glow/10' },
  ERROR: { icon: XCircle, color: 'text-red-glow', border: 'border-red-glow/40', bg: 'bg-red-glow/10' },
};

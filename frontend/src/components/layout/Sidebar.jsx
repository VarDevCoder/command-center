// Sidebar de navegación — estilo Captain's Bridge
import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  TerminalSquare,
  Rocket,
  History,
  Radio,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', icon: LayoutGrid, label: 'Bridge', end: true },
  { to: '/terminals', icon: TerminalSquare, label: 'Terminals' },
  { to: '/launch', icon: Rocket, label: 'Mission' },
  { to: '/history', icon: History, label: 'History' },
];

export default function Sidebar() {
  return (
    <aside className="w-16 lg:w-52 bg-bridge-800 border-r border-bridge-700 flex flex-col">
      {/* Logo */}
      <div className="h-14 flex items-center justify-center lg:justify-start lg:px-4 border-b border-bridge-700">
        <Radio className="w-6 h-6 text-cyan-glow" />
        <span className="hidden lg:inline ml-2 font-mono text-sm font-semibold text-cyan-glow tracking-wider">
          CMD CENTER
        </span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center px-4 py-3 mx-2 rounded-lg transition-all duration-200 group ${
                isActive
                  ? 'bg-bridge-700 text-cyan-glow'
                  : 'text-bridge-400 hover:text-bridge-200 hover:bg-bridge-700/50'
              }`
            }
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            <span className="hidden lg:inline ml-3 text-sm font-medium">
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Indicador de versión */}
      <div className="p-4 border-t border-bridge-700">
        <p className="hidden lg:block text-[10px] font-mono text-bridge-500 text-center">
          v1.0.0
        </p>
      </div>
    </aside>
  );
}

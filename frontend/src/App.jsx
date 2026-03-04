// Rutas de la aplicación — sin auth (app local)
import { Routes, Route } from 'react-router-dom';
import BridgeLayout from './components/layout/BridgeLayout.jsx';
import BridgePage from './pages/BridgePage.jsx';
import AgentDetailPage from './pages/AgentDetailPage.jsx';
import MissionPage from './pages/MissionPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import TerminalPage from './pages/TerminalPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BridgeLayout />}>
        <Route index element={<BridgePage />} />
        <Route path="agent/:agentId" element={<AgentDetailPage />} />
        <Route path="terminals" element={<TerminalPage />} />
        <Route path="launch" element={<MissionPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="history/:sessionId" element={<AgentDetailPage />} />
      </Route>
    </Routes>
  );
}

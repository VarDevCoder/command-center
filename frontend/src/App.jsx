// Rutas de la aplicación — sin auth (app local)
import { Routes, Route } from 'react-router-dom';
import BridgeLayout from './components/layout/BridgeLayout.jsx';
import BridgePage from './pages/BridgePage.jsx';
import AgentDetailPage from './pages/AgentDetailPage.jsx';
import MissionPage from './pages/MissionPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import VioletPage from './pages/VioletPage.jsx';
import VioletProfilePage from './pages/VioletProfilePage.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import PullRequestsPage from './pages/PullRequestsPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BridgeLayout />}>
        <Route index element={<BridgePage />} />
        <Route path="agent/:agentId" element={<AgentDetailPage />} />
        <Route path="launch" element={<MissionPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="violet" element={<VioletPage />} />
        <Route path="violet/profile" element={<VioletProfilePage />} />
        <Route path="chats" element={<ChatsPage />} />
        <Route path="pull-requests" element={<PullRequestsPage />} />
        <Route path="operations" element={<OperationsPage />} />
      </Route>
    </Routes>
  );
}

// Llamadas REST al backend — sin auth (app local)
const BASE = '/api/v1';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || 'Error desconocido');
  return data.data;
}

export const agentApi = {
  list: () => request('/agents'),
  providers: () => request('/agents/providers'),
  loginClaude: (email) => request('/agents/providers/claude/login', {
    method: 'POST',
    body: JSON.stringify(email ? { email } : {}),
  }),
  get: (id) => request(`/agents/${id}`),
  spawn: (body) => request('/agents', { method: 'POST', body: JSON.stringify(body) }),
  stop: (id) => request(`/agents/${id}/stop`, { method: 'POST' }),
  send: (id, prompt) => request(`/agents/${id}/send`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  }),
};

export const sessionApi = {
  list: (limit = 50) => request(`/sessions?limit=${limit}`),
  get: (id) => request(`/sessions/${id}`),
};

export const projectApi = {
  list: () => request('/projects'),
  clone: (body) => request('/projects/clone', { method: 'POST', body: JSON.stringify(body) }),
  scanStatus: () => request('/projects/scan-status'),
  rescan: () => request('/projects/rescan', { method: 'POST' }),
};

export const healthApi = {
  check: () => request('/health'),
};

export const violetApi = {
  history: () => request('/violet/history'),
  chat: (text, images = []) => request('/violet/chat', {
    method: 'POST',
    body: JSON.stringify({ text, images }),
  }),
};

export const chatsApi = {
  list: () => request('/chats'),
  history: (repoDir, provider = 'claude') =>
    request(`/chats/history?repoDir=${encodeURIComponent(repoDir)}&provider=${provider}`),
  send: (repoDir, repoName, text, provider = 'claude') => request('/chats/send', {
    method: 'POST',
    body: JSON.stringify({ repoDir, repoName, text, provider }),
  }),
};

export const ollamaApi = {
  list: () => request('/agents/ollama-tasks'),
  get: (taskId) => request(`/agents/ollama-tasks/${taskId}`),
};

export const supervisedApi = {
  list: (filters = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const qs = params.toString();
    return request(`/supervised-tasks${qs ? `?${qs}` : ''}`);
  },
  get: (taskId) => request(`/supervised-tasks/${taskId}`),
  publish: (taskId) => request(`/supervised-tasks/${taskId}/publish`, { method: 'POST' }),
  merge: (taskId) => request(`/supervised-tasks/${taskId}/merge`, { method: 'POST' }),
};

export const vscodeAgentApi = {
  list: () => request('/vscode-agents'),
  open: (projectDir) => request('/vscode-agents/open', { method: 'POST', body: JSON.stringify({ projectDir }) }),
  stop: (uri) => request('/vscode-agents/stop', { method: 'POST', body: JSON.stringify({ uri }) }),
};

export const usageApi = {
  summary: (days = 30) => request(`/usage?days=${days}`),
};

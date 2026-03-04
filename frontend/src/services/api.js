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
};

export const terminalApi = {
  list: () => request('/terminals'),
  get: (id) => request(`/terminals/${id}`),
  create: (body = {}) => request('/terminals', { method: 'POST', body: JSON.stringify(body) }),
  kill: (id) => request(`/terminals/${id}`, { method: 'DELETE' }),
};

export const healthApi = {
  check: () => request('/health'),
};

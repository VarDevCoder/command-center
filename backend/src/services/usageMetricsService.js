import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { PATHS } from '../utils/paths.js';

const CODEX_SESSIONS = process.env.CODEX_SESSIONS_DIR || join(homedir(), '.codex', 'sessions');

const PRICING = {
  openai: [
    { match: /gpt-6\.1-sol/i, input: 1, cached: 0.05, output: 5 },
    { match: /gpt-6-astra/i, input: 5, cached: 0.5, output: 25 },
    { match: /gpt-6-luna/i, input: 0.05, cached: 0.005, output: 0.25 },
    { match: /gpt-5\.6/i, input: 4, cached: 0.4, output: 20 },
    { match: /.*/, input: 1, cached: 0.1, output: 5 },
  ],
  anthropic: [
    { match: /sonnet-5\.5|sonnet 5\.5/i, input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
    { match: /sonnet-5|sonnet 5/i, input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 },
    { match: /opus-5\.5|opus 5\.5/i, input: 4, cached: 0.2, cacheWrite: 5, output: 20 },
    { match: /sonnet/i, input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
    { match: /haiku/i, input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 },
    { match: /.*/, input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 },
  ],
};

async function filesUnder(root, cutoff) {
  const result = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.jsonl')) {
        const info = await stat(path);
        if (info.mtimeMs >= cutoff) result.push(path);
      }
    }
  }
  await walk(root);
  return result;
}

function empty(provider) {
  return { provider, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, sessions: 0, estimatedApiCostUsd: 0, models: {} };
}

function addModel(total, model, usage) {
  const key = model || 'desconocido';
  const row = total.models[key] ||= { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, estimatedApiCostUsd: 0 };
  for (const field of ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens']) row[field] += usage[field] || 0;
}

function calculate(total, provider) {
  total.estimatedApiCostUsd = Object.entries(total.models).reduce((sum, [model, usage]) => {
    const rate = PRICING[provider].find((item) => item.match.test(model));
    const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
    const cost = (uncached * rate.input + usage.cachedInputTokens * rate.cached + usage.cacheWriteTokens * (rate.cacheWrite || rate.input) + usage.outputTokens * rate.output) / 1_000_000;
    usage.estimatedApiCostUsd = cost;
    return sum + cost;
  }, 0);
  return total;
}

async function claudeUsage(cutoff) {
  const total = empty('claude');
  for (const path of await filesUnder(PATHS.projectsDir, cutoff)) {
    let counted = false;
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        const usage = event.message?.usage;
        if (!usage) continue;
        const normalized = {
          inputTokens: usage.input_tokens || 0,
          cachedInputTokens: usage.cache_read_input_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
        };
        total.inputTokens += normalized.inputTokens;
        total.cachedInputTokens += normalized.cachedInputTokens;
        total.cacheWriteTokens += normalized.cacheWriteTokens;
        total.outputTokens += normalized.outputTokens;
        addModel(total, event.message?.model || 'claude-sonnet', normalized);
        counted = true;
      } catch { /* línea parcial */ }
    }
    if (counted) total.sessions++;
  }
  return calculate(total, 'anthropic');
}

async function codexUsage(cutoff) {
  const total = empty('chatgpt-codex');
  let latestRateLimits = null;
  for (const path of await filesUnder(CODEX_SESSIONS, cutoff)) {
    let model = 'gpt-6.1-sol';
    let last = null;
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.payload?.model) model = event.payload.model;
        if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
          if (event.payload.info?.total_token_usage) last = event.payload.info.total_token_usage;
          if (event.payload.rate_limits) latestRateLimits = event.payload.rate_limits;
        }
      } catch { /* línea parcial */ }
    }
    if (!last) continue;
    const normalized = {
      inputTokens: last.input_tokens || 0,
      cachedInputTokens: last.cached_input_tokens || 0,
      cacheWriteTokens: last.cache_write_input_tokens || 0,
      outputTokens: last.output_tokens || 0,
    };
    total.inputTokens += normalized.inputTokens;
    total.cachedInputTokens += normalized.cachedInputTokens;
    total.cacheWriteTokens += normalized.cacheWriteTokens;
    total.outputTokens += normalized.outputTokens;
    total.reasoningTokens += last.reasoning_output_tokens || 0;
    total.sessions++;
    addModel(total, model, normalized);
  }
  total.rateLimits = latestRateLimits;
  return calculate(total, 'openai');
}

export const usageMetricsService = {
  async getSummary(days = 30) {
    const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
    const cutoff = Date.now() - safeDays * 86400000;
    const [claude, chatgpt] = await Promise.all([claudeUsage(cutoff), codexUsage(cutoff)]);
    return {
      periodDays: safeDays,
      generatedAt: new Date().toISOString(),
      actualCostAvailable: false,
      note: 'Costo API equivalente estimado. Las suscripciones de Claude y ChatGPT no exponen el cargo real por sesión.',
      providers: { claude, chatgpt },
      estimatedApiCostUsd: claude.estimatedApiCostUsd + chatgpt.estimatedApiCostUsd,
    };
  },
};


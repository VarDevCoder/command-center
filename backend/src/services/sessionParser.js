// Servicio para parsear archivos JSONL de sesiones de Claude Code
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/**
 * Parsea una línea JSONL y extrae datos relevantes para el UI
 */
export function parseSessionLine(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data.type) return null;

    const base = {
      uuid: data.uuid || data.messageId || null,
      parentUuid: data.parentUuid || null,
      sessionId: data.sessionId || null,
      timestamp: data.timestamp || null,
      cwd: data.cwd || null,
    };

    // Snapshot de archivos — ignorar para el log viewer
    if (data.type === 'file-history-snapshot') return null;

    // Mensaje de usuario
    if (data.type === 'user') {
      return {
        ...base,
        type: 'user',
        content: extractTextContent(data.message?.content),
      };
    }

    // Mensaje de asistente
    if (data.type === 'assistant') {
      return parseAssistantMessage(data, base);
    }

    // Progreso de subagente
    if (data.type === 'progress') {
      return {
        ...base,
        type: 'progress',
        content: data.content || 'Processing...',
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extrae texto legible del content de un mensaje
 */
function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Parsea un mensaje de assistant y extrae texto, herramientas, y uso de tokens
 */
function parseAssistantMessage(data, base) {
  const msg = data.message;
  if (!msg?.content) return null;

  const entries = [];
  const contentBlocks = Array.isArray(msg.content) ? msg.content : [];

  for (const block of contentBlocks) {
    if (block.type === 'thinking') {
      entries.push({
        ...base,
        type: 'thinking',
        content: (block.thinking || '').slice(0, 300),
      });
    } else if (block.type === 'text') {
      entries.push({
        ...base,
        type: 'assistant',
        content: block.text,
      });
    } else if (block.type === 'tool_use') {
      entries.push({
        ...base,
        type: 'tool_use',
        toolName: block.name,
        toolId: block.id,
        content: summarizeToolInput(block.name, block.input),
      });
    } else if (block.type === 'tool_result') {
      entries.push({
        ...base,
        type: 'tool_result',
        toolId: block.tool_use_id,
        content: extractTextContent(block.content)?.slice(0, 500),
        isError: block.is_error || false,
      });
    }
  }

  // Agregar info de tokens al primer entry
  if (entries.length > 0 && msg.usage) {
    entries[0].tokens = {
      input: msg.usage.input_tokens || 0,
      output: msg.usage.output_tokens || 0,
    };
  }

  return entries.length === 1 ? entries[0] : entries;
}

/**
 * Resume el input de una herramienta para mostrar en el log
 */
function summarizeToolInput(toolName, input) {
  if (!input) return '';
  switch (toolName) {
    case 'Bash':
      return input.command || '';
    case 'Read':
    case 'Glob':
      return input.file_path || input.pattern || '';
    case 'Write':
      return input.file_path || '';
    case 'Edit':
      return input.file_path || '';
    case 'Grep':
      return `${input.pattern || ''} ${input.path || ''}`.trim();
    case 'Agent':
      return input.description || input.prompt?.slice(0, 100) || '';
    default:
      return JSON.stringify(input).slice(0, 150);
  }
}

/**
 * Lee todas las entradas parseadas de un archivo de sesión
 */
export async function parseSessionFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const entries = [];

  for (const line of lines) {
    const parsed = parseSessionLine(line);
    if (parsed) {
      if (Array.isArray(parsed)) {
        entries.push(...parsed);
      } else {
        entries.push(parsed);
      }
    }
  }

  return entries;
}

/**
 * Lee nuevas líneas desde un byte offset específico
 */
export async function readNewLines(filePath, fromByte) {
  const fileStat = await stat(filePath);
  if (fileStat.size <= fromByte) {
    return { entries: [], newOffset: fromByte };
  }

  const stream = createReadStream(filePath, {
    start: fromByte,
    encoding: 'utf8',
  });
  const rl = createInterface({ input: stream });
  const entries = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parsed = parseSessionLine(line);
    if (parsed) {
      if (Array.isArray(parsed)) {
        entries.push(...parsed);
      } else {
        entries.push(parsed);
      }
    }
  }

  return { entries, newOffset: fileStat.size };
}

/**
 * Extrae metadata básica de una sesión sin parsear todo el archivo
 */
export async function getSessionMeta(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);

  let sessionId = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let messageCount = 0;
  let totalTokens = { input: 0, output: 0 };
  let firstUserPrompt = '';

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.type === 'file-history-snapshot') continue;

      if (!sessionId && data.sessionId) sessionId = data.sessionId;
      if (!firstTimestamp && data.timestamp) firstTimestamp = data.timestamp;
      if (data.timestamp) lastTimestamp = data.timestamp;

      if (data.type === 'user' || data.type === 'assistant') {
        messageCount++;
      }

      if (data.type === 'user' && !firstUserPrompt) {
        firstUserPrompt = extractTextContent(data.message?.content)?.slice(0, 100);
      }

      if (data.message?.usage) {
        totalTokens.input += data.message.usage.input_tokens || 0;
        totalTokens.output += data.message.usage.output_tokens || 0;
      }
    } catch {
      // Ignorar líneas inválidas
    }
  }

  return {
    sessionId,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    totalTokens,
    preview: firstUserPrompt,
  };
}

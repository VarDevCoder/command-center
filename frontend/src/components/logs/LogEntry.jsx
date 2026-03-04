// Entrada individual de log — estilo terminal
import { useState } from 'react';
import { formatTime } from '../../utils/formatters.js';

const TYPE_STYLES = {
  user: { prefix: '>', color: 'text-cyan-glow', bg: '' },
  assistant: { prefix: '<', color: 'text-bridge-200', bg: '' },
  thinking: { prefix: '...', color: 'text-amber-glow', bg: 'italic opacity-60' },
  tool_use: { prefix: '[tool]', color: 'text-purple-glow', bg: '' },
  tool_result: { prefix: '  =>', color: 'text-bridge-500', bg: '' },
  error: { prefix: '!', color: 'text-red-glow', bg: 'bg-red-glow/5' },
  output: { prefix: '|', color: 'text-bridge-300', bg: '' },
  progress: { prefix: '~', color: 'text-bridge-500', bg: '' },
};

export default function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const style = TYPE_STYLES[entry.type] || TYPE_STYLES.output;
  const isLong = entry.content?.length > 200;

  return (
    <div className={`flex gap-2 py-1 px-2 hover:bg-bridge-800/50 rounded text-xs font-mono ${style.bg}`}>
      {/* Timestamp */}
      <span className="text-bridge-600 flex-shrink-0 w-16 select-none">
        {formatTime(entry.timestamp)}
      </span>

      {/* Prefijo de tipo */}
      <span className={`flex-shrink-0 w-14 ${style.color} select-none`}>
        {style.prefix}
        {entry.toolName && (
          <span className="text-purple-glow"> {entry.toolName}</span>
        )}
      </span>

      {/* Contenido */}
      <div className={`flex-1 min-w-0 ${style.color} break-words whitespace-pre-wrap`}>
        {isLong && !expanded ? (
          <>
            {entry.content.slice(0, 200)}
            <button
              onClick={() => setExpanded(true)}
              className="text-cyan-glow hover:underline ml-1"
            >
              [+more]
            </button>
          </>
        ) : (
          entry.content
        )}
        {isLong && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-cyan-glow hover:underline ml-1 block"
          >
            [-less]
          </button>
        )}
      </div>
    </div>
  );
}

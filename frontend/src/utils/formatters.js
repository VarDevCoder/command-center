// Utilidades de formato para el Command Center

/**
 * Formatea timestamp a HH:MM:SS
 */
export function formatTime(timestamp) {
  if (!timestamp) return '--:--:--';
  const d = new Date(typeof timestamp === 'number' ? timestamp : timestamp);
  return d.toLocaleTimeString('es-AR', { hour12: false });
}

/**
 * Formatea timestamp a fecha corta
 */
export function formatDate(timestamp) {
  if (!timestamp) return '--';
  const d = new Date(typeof timestamp === 'number' ? timestamp : timestamp);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

/**
 * Formatea timestamp a fecha y hora completa
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return '--';
  return `${formatDate(timestamp)} ${formatTime(timestamp)}`;
}

/**
 * Formatea número de tokens (ej: 12450 -> "12.4K")
 */
export function formatTokens(count) {
  if (!count || count === 0) return '0';
  if (count < 1000) return count.toString();
  if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1000000).toFixed(1)}M`;
}

/**
 * Trunca texto a maxLen caracteres
 */
export function truncate(text, maxLen = 80) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

/**
 * Extrae nombre corto de un path de proyecto
 * "C:/Dev/Desarrollo/01-catalogo-whatsapp" -> "01-catalogo-whatsapp"
 */
export function projectName(dirPath) {
  if (!dirPath) return 'unknown';
  return dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
}

/**
 * Calcula tiempo relativo (hace 5 min, hace 2h, etc)
 */
export function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const diff = Math.floor((now - ts) / 1000);

  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

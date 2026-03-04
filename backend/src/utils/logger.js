// Logger simple con timestamps y prefijos de color
const COLORS = {
  info: '\x1b[36m',   // cyan
  error: '\x1b[31m',  // rojo
  warn: '\x1b[33m',   // amarillo
  reset: '\x1b[0m',
};

export function createLogger(prefix) {
  const ts = () => new Date().toISOString().slice(11, 19);
  return {
    info: (msg, ...args) =>
      console.log(`${COLORS.info}[${ts()}][${prefix}]${COLORS.reset} ${msg}`, ...args),
    error: (msg, ...args) =>
      console.error(`${COLORS.error}[${ts()}][${prefix}]${COLORS.reset} ${msg}`, ...args),
    warn: (msg, ...args) =>
      console.warn(`${COLORS.warn}[${ts()}][${prefix}]${COLORS.reset} ${msg}`, ...args),
  };
}

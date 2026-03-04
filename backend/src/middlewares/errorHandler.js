// Middleware global de errores
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = err.message || 'Error interno del servidor';
  console.error(`[ERROR] ${req.method} ${req.path}: ${message}`);
  res.status(status).json({ success: false, error: { message } });
}

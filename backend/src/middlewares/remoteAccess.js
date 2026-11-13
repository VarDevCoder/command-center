// Acceso remoto: lo que no nace en esta PC solo entra con un login válido de Cloudflare Access.
// Sin login, lanzar un agente equivale a ejecutar comandos acá, así que ante la duda se rechaza.
import { createRemoteJWKSet, jwtVerify } from 'jose';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
// Cloudflare siempre agrega estos encabezados: su presencia delata que el pedido vino por el túnel,
// aunque el túnel reescriba el Host a localhost.
const PROXY_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for'];

export function isLocalRequest(headers) {
  return LOCAL_HOST.test(headers.host ?? '') && !PROXY_HEADERS.some((name) => headers[name]);
}

/**
 * No alcanza con confiar en el encabezado del correo: si Access quedara mal configurado,
 * cualquiera podría inventarlo. Se verifica la firma del token contra las claves del equipo.
 */
export function createAccessGuard({ teamDomain, audience, email, keys } = {}) {
  const configured = Boolean(teamDomain && audience);
  const keySet = keys ?? (configured
    ? createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`))
    : null);

  return async function isAllowed(headers) {
    if (isLocalRequest(headers)) return true;
    const token = headers['cf-access-jwt-assertion'];
    if (!configured || !token) return false;
    try {
      const { payload } = await jwtVerify(token, keySet, { issuer: `https://${teamDomain}`, audience });
      return !email || String(payload.email).toLowerCase() === email.toLowerCase();
    } catch {
      return false;
    }
  };
}

try {
  process.loadEnvFile();
} catch { /* sin .env solo se atiende a esta PC */ }

export const remoteAccessEnabled = Boolean(process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_AUD);

export const isAllowed = createAccessGuard({
  teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
  audience: process.env.CF_ACCESS_AUD,
  email: process.env.CF_ACCESS_EMAIL,
});

export async function requireAccess(req, res, next) {
  if (await isAllowed(req.headers)) return next();
  res.status(403).json({ success: false, error: { message: 'Acceso denegado' } });
}

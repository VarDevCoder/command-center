import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createAccessGuard, isLocalRequest } from './remoteAccess.js';

const TEAM = 'equipo.cloudflareaccess.com';
const AUD = 'aud-de-la-app';
const EMAIL = 'jefe@example.com';
const REMOTE = { host: 'cc.example.com', 'cf-connecting-ip': '203.0.113.9' };

let guard;
let sign;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  guard = createAccessGuard({ teamDomain: TEAM, audience: AUD, email: EMAIL, keys: createLocalJWKSet({ keys: [jwk] }) });
  sign = ({ email = EMAIL, issuer = `https://${TEAM}`, audience = AUD, key = privateKey, expires = '5m' } = {}) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expires)
      .sign(key);
});

const withToken = async (options) => ({ ...REMOTE, 'cf-access-jwt-assertion': await sign(options) });

describe('pedidos de esta PC', () => {
  it('pasan sin login, directos o por el proxy de Vite', async () => {
    expect(await guard({ host: '127.0.0.1:3066' })).toBe(true);
    expect(await guard({ host: 'localhost:5166' })).toBe(true);
  });

  it('un Host local que llegó por el túnel no cuenta como local', () => {
    expect(isLocalRequest({ host: 'localhost:3066', 'cf-ray': 'abc' })).toBe(false);
    expect(isLocalRequest({ host: 'localhost:3066', 'x-forwarded-for': '203.0.113.9' })).toBe(false);
  });
});

describe('pedidos remotos', () => {
  it('entran con un token válido del Jefe', async () => {
    expect(await guard(await withToken())).toBe(true);
  });

  it('se rechazan sin token o con un correo inventado en un encabezado', async () => {
    expect(await guard(REMOTE)).toBe(false);
    expect(await guard({ ...REMOTE, 'cf-access-authenticated-user-email': EMAIL })).toBe(false);
  });

  it('se rechazan con otro correo, otra app, otro equipo o un token vencido', async () => {
    expect(await guard(await withToken({ email: 'otro@example.com' }))).toBe(false);
    expect(await guard(await withToken({ audience: 'otra-app' }))).toBe(false);
    expect(await guard(await withToken({ issuer: 'https://otro.cloudflareaccess.com' }))).toBe(false);
    expect(await guard(await withToken({ expires: '-1m' }))).toBe(false);
  });

  it('se rechazan si el token lo firmó otra clave', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    expect(await guard(await withToken({ key: privateKey }))).toBe(false);
  });

  it('se rechazan todos mientras Access no esté configurado', async () => {
    const unconfigured = createAccessGuard();
    expect(await unconfigured(await withToken())).toBe(false);
    expect(await unconfigured({ host: '127.0.0.1:3066' })).toBe(true);
  });
});

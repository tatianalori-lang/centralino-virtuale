import { config } from './config.js';

/**
 * Middleware di autenticazione HTTP Basic per la dashboard.
 * Attivo solo se DASHBOARD_USER e DASHBOARD_PASS sono configurati.
 */
export function basicAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;

  // Se non configurato, nessuna autenticazione (sviluppo).
  if (!user || !pass) return next();

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Centralino Virtuale"');
    return res.status(401).send('Autenticazione richiesta');
  }

  let decoded;
  try {
    decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  } catch {
    res.setHeader('WWW-Authenticate', 'Basic realm="Centralino Virtuale"');
    return res.status(401).send('Credenziali non valide');
  }

  const idx = decoded.indexOf(':');
  const u = idx >= 0 ? decoded.slice(0, idx) : '';
  const p = idx >= 0 ? decoded.slice(idx + 1) : '';

  if (u === user && p === pass) return next();

  res.setHeader('WWW-Authenticate', 'Basic realm="Centralino Virtuale"');
  return res.status(401).send('Credenziali non valide');
}

export function authStatus() {
  return {
    enabled: Boolean(process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS),
    user: process.env.DASHBOARD_USER || null
  };
}
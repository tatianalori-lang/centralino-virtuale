import nodemailer from 'nodemailer';
import { config } from './config.js';

const mail = config.mail;

let transporter = null;

function getTransporter() {
  if (!mail.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    });
  }
  return transporter;
}

export function isMailConfigured() {
  return Boolean(mail.host && mail.to && mail.user && mail.pass);
}

export function mailStatus() {
  return {
    configured: isMailConfigured(),
    to: mail.to,
    host: mail.host || '',
    from: mail.from || ''
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function rows(ticket) {
  const caller = ticket.caller || {};
  return [
    ['Ticket', ticket.id],
    ['Data', ticket.createdAt],
    ['Stato', ticket.status],
    ['Priorità', ticket.priority],
    ['Urgenza', ticket.urgency],
    ['Canale', ticket.source],
    ['Nome', caller.name],
    ['Azienda', caller.company],
    ['Indirizzo', caller.address],
    ['Email', caller.email],
    ['Telefono', caller.phone],
    ['Motivo', ticket.reason],
    ['Prodotto', ticket.product],
    ['Problematica', ticket.issue],
    ['Chiamata da', ticket.call?.from],
    ['Call SID', ticket.call?.sid]
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
}

export function ticketSubject(ticket) {
  return `Nuovo ticket ${ticket.id} - ${ticket.reason || 'Assistenza'}`;
}

export function ticketText(ticket) {
  const lines = rows(ticket).map(([label, value]) => `${label}: ${value}`);
  return [
    `${config.welcomeMessage}.`,
    '',
    'È stato creato un nuovo ticket di assistenza:',
    '',
    ...lines,
    '',
    'Dashboard: http://localhost:' + config.port
  ].join('\n');
}

const RED = '#dc2626';
const GREEN = '#059669';

function isHighPriority(ticket) {
  return (
    String(ticket.priority || '').toLowerCase() === 'alta' ||
    String(ticket.urgency || '').toLowerCase() === 'alta'
  );
}

function rowHtml([label, value], ticket) {
  let color = null;
  if (label === 'Priorità' || label === 'Urgenza') {
    color = isHighPriority(ticket) ? RED : GREEN;
  } else if (label === 'Stato') {
    color = GREEN;
  }

  const thStyle =
    'text-align:left;padding:6px 10px;color:#64748b;font-weight:600;white-space:nowrap' +
    (color ? `;color:${color}` : '');
  const tdStyle =
    'padding:6px 10px' + (color ? `;color:${color};font-weight:700` : '');

  return `<tr><th style="${thStyle}">${escapeHtml(
    label
  )}</th><td style="${tdStyle}">${escapeHtml(value)}</td></tr>`;
}

export function ticketHtml(ticket) {
  const body = rows(ticket).map((row) => rowHtml(row, ticket)).join('');

  return `<!doctype html><html lang="it"><body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <h2 style="margin:0 0 4px">${escapeHtml(config.welcomeMessage)}</h2>
  <p style="margin:0 0 18px;color:#64748b">È stato creato un nuovo ticket di assistenza.</p>
  <table style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px">${body}</table>
  <p style="margin-top:18px;font-size:12px;color:#64748b">Messaggio generato automaticamente dal centralino virtuale.</p>
  </body></html>`;
}

/**
 * Invia il ticket via email. Non solleva eccezioni: restituisce sempre un esito.
 */
export async function sendTicketEmail(ticket) {
  if (!isMailConfigured()) {
    return { sent: false, reason: 'SMTP non configurato' };
  }

  const transport = getTransporter();
  if (!transport) return { sent: false, reason: 'SMTP non configurato' };

  try {
    await transport.sendMail({
      from: mail.from || mail.user,
      to: mail.to,
      subject: ticketSubject(ticket),
      text: ticketText(ticket),
      html: ticketHtml(ticket)
    });
    return { sent: true, to: mail.to };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

import { config } from './config.js';

const wa = config.whatsapp;

export function shouldNotifyEmail() {
  return wa.channel === 'email' || wa.channel === 'both';
}

export function shouldNotifyWhatsApp() {
  return wa.enabled && (wa.channel === 'whatsapp' || wa.channel === 'both');
}

export function whatsappStatus() {
  return {
    enabled: wa.enabled,
    channel: wa.channel,
    configured: Boolean(config.telnyx.apiKey && wa.from && wa.to),
    from: wa.from,
    to: wa.to,
    toCaller: wa.toCaller,
    template: wa.templateName || null,
    provider: 'telnyx'
  };
}

/** Normalizza un numero in formato E.164 grezzo (senza spazi). */
export function normalizeE164(value) {
  let v = String(value || '').replace(/[^\d+]/g, '');
  if (!v) return '';
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (!v.startsWith('+')) {
    // Numeri italiani senza prefisso: aggiungi +39.
    v = v.startsWith('39') ? `+${v}` : `+39${v}`;
  }
  return v;
}

export function ticketMessage(ticket) {
  const c = ticket.caller || {};
  const parts = [
    `Nuovo ticket ${ticket.id}`,
    `Motivo: ${ticket.reason || 'non indicato'}`,
    ticket.product ? `Prodotto: ${ticket.product}` : null,
    `Urgenza: ${ticket.urgency || 'non indicata'}`,
    `Problema: ${ticket.issue || 'non specificato'}`,
    `Nome: ${c.name || 'non fornito'}`,
    `Telefono: ${c.phone || 'non indicato'}`
  ].filter(Boolean);
  if (c.company) parts.push(`Azienda: ${c.company}`);
  if (c.address) parts.push(`Indirizzo: ${c.address}`);
  if (c.email) parts.push(`Email: ${c.email}`);
  return `${config.welcomeMessage}.\n\n${parts.join('\n')}`;
}

function payload(recipient, text) {
  const message = wa.templateName
    ? {
        type: 'template',
        template: {
          name: wa.templateName,
          language: { policy: 'deterministic', code: wa.templateLanguage },
          components: [
            { type: 'body', parameters: [{ type: 'text', text }] }
          ]
        }
      }
    : { type: 'text', text: { body: text, preview_url: false } };

  return {
    from: wa.from,
    to: recipient,
    whatsapp_message: message
  };
}

/**
 * Invia il riepilogo del ticket via WhatsApp (Telnyx).
 * Non solleva eccezioni: restituisce sempre un esito.
 */
export async function sendTicketWhatsApp(ticket, options = {}) {
  if (!wa.enabled) return { sent: false, reason: 'WhatsApp disabilitato' };
  if (!config.telnyx.apiKey) {
    return { sent: false, reason: 'TELNYX_API_KEY non configurata' };
  }

  const recipient = normalizeE164(
    options.to ||
      (wa.toCaller ? ticket.caller?.phone : wa.to) ||
      wa.to
  );
  if (!recipient || recipient.replace(/\D/g, '').length < 8) {
    return { sent: false, reason: 'Numero destinatario WhatsApp non valido' };
  }

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages/whatsapp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.telnyx.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload(recipient, ticketMessage(ticket)))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        data?.errors?.map((e) => e.detail || e.title).join('; ') ||
        data?.message ||
        `${res.status}`;
      return { sent: false, reason: detail };
    }
    return { sent: true, to: recipient, id: data?.data?.id || null };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

import { config } from './config.js';
import { isOwnNumber } from './callerId.js';

/**
 * Stato dell'integrazione Twilio Insights.
 */
export function twilioInsightsStatus() {
  return {
    configured: Boolean(config.twilio.accountSid && config.twilio.authToken),
    accountSid: Boolean(config.twilio.accountSid),
    authToken: Boolean(config.twilio.authToken)
  };
}

/**
 * Recupera il numero del chiamante originale da Twilio Insights.
 * Interroga l'API Summary per ottenere i metadati della chiamata.
 *
 * @param {string} callSid - SID della chiamata Twilio
 * @returns {Promise<string>} numero del chiamante ('' se non trovato)
 */
export async function findOriginalCallerFromInsights(callSid) {
  const accountSid = config.twilio.accountSid;
  const authToken = config.twilio.authToken;
  if (!accountSid || !authToken || !callSid) return '';

  const url = `https://insights.twilio.com/v1/Voice/${encodeURIComponent(callSid)}/Summary`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        Accept: 'application/json'
      }
    });
  } catch (err) {
    console.error(`[TwilioInsights] errore di rete: ${err.message}`);
    return '';
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`[TwilioInsights] HTTP ${res.status}: ${text.slice(0, 200)}`);
    return '';
  }

  const body = await res.json().catch(() => ({}));

  // Twilio Insights Summary contiene i metadati della chiamata.
  // Il campo "from" dovrebbe contenere il caller ID originale.
  const from = body.from || body.caller || body.caller_number || '';
  const to = body.to || body.called || '';

  if (!from || isOwnNumber(from)) return '';

  // Normalizza: rimuovi spazi
  return String(from).replace(/\s+/g, '');
}
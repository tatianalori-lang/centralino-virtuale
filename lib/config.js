import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

function readCatalog() {
  const file = path.join(ROOT_DIR, 'config', 'catalog.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Impossibile leggere ${file}: ${err.message}`);
    return {
      reasons: [
        { key: '1', value: 'Assistenza tecnica' },
        { key: '2', value: 'Informazioni commerciali' },
        { key: '3', value: 'Amministrazione e fatturazione' },
        { key: '4', value: 'Altro' }
      ],
      products: [
        { key: '1', value: 'Software' },
        { key: '2', value: 'Attrezzature' },
        { key: '3', value: 'Bilance' },
        { key: '4', value: 'Registratori di cassa' },
        { key: '5', value: 'Cassetti automatici' }
      ]
    };
  }
}

const env = process.env;
const forwardNumber = env.FORWARD_NUMBER || env.OPERATOR_PHONE_NUMBER || '';
const companyName = env.COMPANY_NAME || 'Assistenza Clienti';

export const config = {
  port: Number(env.PORT || 3000),
  // Secondi di attesa prima di considerare l'inoltro non risposto (≈ squilli).
  // 0 = nessuno squillo verso il centralino: si registra la richiesta e si
  // comunica il ricontatto, senza far attendere il chiamante.
  dialTimeoutSeconds: Math.min(600, Math.max(0, Number(env.DIAL_TIMEOUT_SECONDS ?? 15))),
  publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  companyName,
  welcomeMessage: env.WELCOME_MESSAGE || `Buongiorno ${companyName}`,
  timezone: env.TZ || 'Europe/Rome',
  centralinoNumber: env.CENTRALINO_NUMBER || '067821202',
  italianNumber: env.ITALIAN_NUMBER || '067821202',
  fallbackNumber: env.FALLBACK_PHONE_NUMBER || '+39067821202',
  messagenetNumber: env.MESSAGENET_NUMBER || '',
  forwardNumber,
  ivr: {
    // voice = solo riconoscimento vocale; both = voce + tasti DTMF come fallback
    inputMode: String(env.IVR_INPUT || 'voice').toLowerCase() === 'both' ? 'both' : 'voice'
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: env.TWILIO_PHONE_NUMBER || '',
    numberSid: env.TWILIO_NUMBER_SID || '',
    operatorNumber: forwardNumber,
    validateSignature: String(env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false',
    voice: env.TWILIO_VOICE || 'Polly.Bianca-Neural',
    language: env.TWILIO_LANGUAGE || 'it-IT'
  },
  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || env.SMTP_USER || '',
    to: env.MAIL_TO || 'assistenza@mtitaliaretail.com'
  },
  telnyx: {
    apiKey: env.TELNYX_API_KEY || '',
    phoneNumber: env.TELNYX_PHONE_NUMBER || '',
    texmlAppId: env.TELNYX_TEXML_APP_ID || '',
    requirementGroupId: env.TELNYX_REQUIREMENT_GROUP_ID || '',
    numberId: env.TELNYX_NUMBER_ID || '',
    voice: env.TELNYX_VOICE || 'Polly.Bianca-Neural',
    language: env.TELNYX_LANGUAGE || 'it-IT',
    publicKey: env.TELNYX_PUBLIC_KEY || ''
  },
  whatsapp: {
    enabled: String(env.WHATSAPP_ENABLED || 'false').toLowerCase() === 'true',
    channel: env.NOTIFY_CHANNEL || 'email',
    from: env.WHATSAPP_FROM || '+39067821202',
    to: env.WHATSAPP_TO || '+39067821202',
    toCaller: String(env.WHATSAPP_TO_CALLER || 'false').toLowerCase() === 'true',
    templateName: env.WHATSAPP_TEMPLATE_NAME || '',
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE || 'it'
  },
  interventi: {
    url: String(env.INTERVENTI_URL || 'https://interventi.mtinterventi.com').replace(/\/+$/, ''),
    username: env.INTERVENTI_USERNAME || '',
    password: env.INTERVENTI_PASSWORD || '',
    // Anagrafica OSM di fallback (es. "CENTRALINO") usata quando il chiamante
    // non è riconducibile a un cliente univoco. Vuoto = resta needCliente.
    defaultCliente: Number(env.INTERVENTI_DEFAULT_CLIENTE) || null,
    // Apre la chiamata su OSM da solo, senza il click "Apri intervento".
    // Impostare INTERVENTI_AUTO_OPEN=false per eseguire test senza scrivere su OSM.
    autoOpen: String(env.INTERVENTI_AUTO_OPEN ?? 'true').toLowerCase() !== 'false',
    // Attivo solo se le credenziali sono configurate (nessuna scrittura OSM
    // durante i test o se non si vuole l'integrazione).
    enabled:
      String(env.INTERVENTI_ENABLED || 'true').toLowerCase() !== 'false' &&
      Boolean(env.INTERVENTI_USERNAME && env.INTERVENTI_PASSWORD)
  }
};

export const catalog = readCatalog();

export function twilioStatus() {
  return {
    accountSid: Boolean(config.twilio.accountSid),
    authToken: Boolean(config.twilio.authToken),
    phoneNumber: Boolean(config.twilio.phoneNumber),
    operatorNumber: Boolean(config.twilio.operatorNumber),
    publicBaseUrl: Boolean(config.publicBaseUrl),
    validateSignature: config.twilio.validateSignature,
    centralinoNumber: config.centralinoNumber,
    forwardNumber: config.forwardNumber,
    ready:
      Boolean(config.twilio.accountSid) &&
      Boolean(config.twilio.authToken) &&
      Boolean(config.twilio.phoneNumber) &&
      Boolean(config.publicBaseUrl)
  };
}

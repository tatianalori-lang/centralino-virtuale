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
  // FORZATO a 0: nessuno squillo prima che l'inoltro subentri. Non viene mai
  // generato un <Dial> verso il centralino/operatore: il ticket è già stato
  // registrato e al chiamante si comunica solo il ricontatto.
  // DIAL_TIMEOUT_SECONDS in .env viene ignorato di proposito.
  dialTimeoutSeconds: 0,
  publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  companyName,
  welcomeMessage: env.WELCOME_MESSAGE || `Buongiorno ${companyName}`,
  timezone: env.TZ || 'Europe/Rome',
  centralinoNumber: env.CENTRALINO_NUMBER || '067821202',
  italianNumber: env.ITALIAN_NUMBER || '067821202',
  fallbackNumber: env.FALLBACK_PHONE_NUMBER || '+39067821202',
  messagenetNumber: env.MESSAGENET_NUMBER || '',
  // URI/account SIP MessageNet (es. 5406639544): è il numero "chiamato"
  // lato Asterisk, NON il chiamante. Va escluso dai numeri del centralino.
  messagenetUri: env.MESSAGENET_SIP_URI || '',
  forwardNumber,
  ivr: {
    // voice = solo riconoscimento vocale; both = voce + tasti DTMF come fallback
    inputMode: String(env.IVR_INPUT || 'voice').toLowerCase() === 'both' ? 'both' : 'voice',
    // Secondi di inattività dopo cui una chiamata non completata apre comunque
    // il ticket, anche se il provider non invia il callback di stato.
    abandonAfterSeconds: Math.max(5, Number(env.IVR_ABANDON_SECONDS || 30))
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
  webex: {
    // Token con scope spark-admin:calling_cdr_read per leggere lo storico
    // chiamate Webex Calling e recuperare il numero del chiamante originale
    // quando la deviazione TIM lo sostituisce con il numero della linea.
    token: String(env.WEBEX_TOKEN || '').trim(),
    // URL del feed CDR Webex (default analytics.webexapis.com).
    cdrUrl: String(env.WEBEX_CDR_URL || 'https://analytics.webexapis.com/v1/cdr_feed').trim(),
    // Numero chiamato sulla linea TIM da cercare nel CDR.
    calledNumber: String(env.WEBEX_CALLED_NUMBER || env.ITALIAN_NUMBER || '067821202').trim(),
    // Finestra di ricerca attorno all'orario della chiamata (minuti).
    windowMinutes: Math.max(1, Number(env.WEBEX_WINDOW_MINUTES || 10)),
    enabled: Boolean(String(env.WEBEX_TOKEN || '').trim())
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
      Boolean(env.INTERVENTI_USERNAME && env.INTERVENTI_PASSWORD),
    // Forza la scheda di intervento tecnico: vuoto = risolto automaticamente
    // dai metadati OSM (tipo «Settore tecnico», stato «1 DA PROGRAMMARE»).
    // Lo stato «8 PROMEMORIA» viene sempre escluso.
    tipoId: Number(env.INTERVENTI_TIPO_ID) || null,
    statoId: Number(env.INTERVENTI_STATO_ID) || null
  },
  voip: {
    transferEnabled: String(env.VOIP_TRANSFER_ENABLED || 'false').toLowerCase() === 'true',
    externalForwardEnabled:
      String(env.VOIP_EXTERNAL_FORWARD_ENABLED || 'false').toLowerCase() === 'true',
    sipUri: String(env.VOIP_SIP_URI || '').trim(),
    dialTimeout: Math.max(5, Math.min(60, Number(env.VOIP_DIAL_TIMEOUT || 25))),
    sipUser: String(env.VOIP_SIP_USER || '').trim(),
    sipPassword: String(env.VOIP_SIP_PASSWORD || '').trim(),
    bridgeToken: String(env.VOIP_BRIDGE_TOKEN || '').trim(),
    contactsXmlToken: String(env.CONTACTS_XML_TOKEN || '').trim()
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

export function voipStatus() {
  return {
    transferEnabled: config.voip.transferEnabled,
    externalForwardEnabled: config.voip.externalForwardEnabled,
    sipUriConfigured: Boolean(config.voip.sipUri),
    dialTimeout: config.voip.dialTimeout,
    sipUserConfigured: Boolean(config.voip.sipUser && config.voip.sipPassword),
    bridgeTokenConfigured: Boolean(config.voip.bridgeToken),
    ready: config.voip.transferEnabled && Boolean(config.voip.sipUri)
  };
}

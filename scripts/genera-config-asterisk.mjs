import fs from 'node:fs';
import path from 'node:path';

// Genera la configurazione Asterisk completa per il centralino VoIP:
// - Ponte SIP MessageNet <-> Twilio SIP Domain (IVR)
// - Interni Yealink W76P (101, 102) e gruppo di squillo 100
// - Chiamate tra interni, trasferimenti e chiamate in uscita via MessageNet
//
// Eseguire come root sul VPS: node /opt/centralino/scripts/genera-config-asterisk.mjs
// Per testare in locale senza scrivere su /etc/asterisk: aggiungere --dry-run

const dryRun = process.argv.includes('--dry-run');
const ENV_FILE =
  process.env.ENV_FILE ||
  (fs.existsSync('/opt/centralino/.env') ? '/opt/centralino/.env' : '.env');
const AST_DIR = '/etc/asterisk';
const PUBLIC_IP = process.env.VPS_PUBLIC_IP || '91.99.150.162';
const MESSAGENET_SBC = '109.233.129.0/24';
const TWILIO_DOMAIN = 'mtitalia-centralino.sip.twilio.com';

if (!fs.existsSync(ENV_FILE)) {
  console.error(`File env non trovato: ${ENV_FILE}`);
  process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
}

const uri = env.MESSAGENET_SIP_URI;
const password = env.MESSAGENET_SIP_PASSWORD;
const domain = env.MESSAGENET_SIP_DOMAIN || 'sip.messagenet.it';
const altUri = env.MESSAGENET_ALT_SIP_URI || '';
const altPassword = env.MESSAGENET_ALT_SIP_PASSWORD || '';
const DEFAULT_EXT_NAMES = {
  101: 'Federica',
  102: 'Damiano',
  103: 'Tatiana',
  104: 'Alessio',
  105: 'Roberto',
  106: 'Benedetto'
};

const rawExtList = (env.ASTERISK_EXTENSIONS || '101,102,103,104,105,106')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => /^(?:10\d|110)$/.test(s));

const voipExtensions = rawExtList.map((ext) => ({
  ext,
  password: env[`ASTERISK_EXT_${ext}_PASSWORD`] || '',
  name: env[`ASTERISK_EXT_${ext}_NAME`] || DEFAULT_EXT_NAMES[ext] || `Interno ${ext}`
}));

const groupAccount = String(env.ASTERISK_GROUP_ACCOUNT || '').trim();
const groupAccountPass = groupAccount ? env[`ASTERISK_EXT_${groupAccount}_PASSWORD`] || '' : '';
const groupAccountName = groupAccount
  ? env[`ASTERISK_EXT_${groupAccount}_NAME`] || 'Centralino'
  : '';

const allPjsipExtensions = [...voipExtensions];
if (groupAccount && !allPjsipExtensions.some((e) => e.ext === groupAccount)) {
  allPjsipExtensions.push({
    ext: groupAccount,
    password: groupAccountPass,
    name: groupAccountName
  });
}

const twilioBridgeUser = env.VOIP_SIP_USER || 'twilio-bridge';
const twilioBridgePass = env.VOIP_SIP_PASSWORD || '';
const bridgeToken = env.VOIP_BRIDGE_TOKEN || '';
const dialTimeout = Math.max(5, Math.min(60, Number(env.VOIP_DIAL_TIMEOUT || 25)));
const outboundCli = (
  env.MESSAGENET_OUTBOUND_CLI ||
  env.MESSAGENET_NUMBER ||
  uri ||
  ''
).replace(/^\+/, '');

if (!uri || !password) {
  console.error('Credenziali SIP MessageNet mancanti in .env (MESSAGENET_SIP_URI / MESSAGENET_SIP_PASSWORD)');
  process.exit(1);
}

const missingExtPass = allPjsipExtensions
  .filter((e) => !e.password)
  .map((e) => `ASTERISK_EXT_${e.ext}_PASSWORD`);
if (!dryRun && (missingExtPass.length || !twilioBridgePass || !bridgeToken)) {
  console.error(
    `Password VoIP mancanti in .env (${[...missingExtPass, 'VOIP_SIP_PASSWORD', 'VOIP_BRIDGE_TOKEN'].join(', ')}).`
  );
  process.exit(1);
}

function backup(file) {
  if (fs.existsSync(file) && !fs.existsSync(`${file}.pre-centralino`)) {
    fs.copyFileSync(file, `${file}.pre-centralino`);
  }
}

function buildExtension(ext, pass, label) {
  return `
[${ext}]
type=endpoint
transport=transport-udp
context=from-internal
disallow=all
allow=alaw
allow=ulaw
allow=g722
auth=auth-${ext}
aors=${ext}
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
ice_support=no
callerid="${label}" <${ext}>
dtmf_mode=rfc4733

[auth-${ext}]
type=auth
auth_type=userpass
username=${ext}
password=${pass || 'CHANGE_ME'}

[${ext}]
type=aor
max_contacts=2
remove_existing=yes
qualify_frequency=30
`;
}

// Nota: in PJSIP l'AOR dell'endpoint deve chiamarsi come indicato in `aors=...`.
// Usiamo sezioni dedicate `[101]` per endpoint e `[aor-101]` per AOR.
const pjsip = `[global]
type=global
user_agent=CentralinoMTItalia
keep_alive_interval=30
endpoint_identifier_order=ip,header,username,auth_username,anonymous

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=${PUBLIC_IP}
external_signaling_address=${PUBLIC_IP}
local_net=127.0.0.1/32

; ---------------------------------------------------------------------------
; Tronco SIP MessageNet (+39 06 8635 8716) - ingresso e uscita
; ---------------------------------------------------------------------------
[auth-messagenet]
type=auth
auth_type=userpass
username=${uri}
password=${password}

[reg-messagenet]
type=registration
transport=transport-udp
client_uri=sip:${uri}@${domain}
server_uri=sip:${domain}
contact_user=${uri}
outbound_auth=auth-messagenet
expiration=600
retry_interval=60
forbidden_retry_interval=300
max_retries=0

[aor-messagenet]
type=aor
contact=sip:${domain}
max_contacts=1
remove_existing=yes

[endpoint-messagenet]
type=endpoint
transport=transport-udp
context=from-messagenet
disallow=all
allow=alaw
allow=ulaw
outbound_auth=auth-messagenet
aors=aor-messagenet
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
ice_support=no
from_user=${uri}
from_domain=${domain}
send_pai=yes
trust_id_inbound=yes

[identify-messagenet]
type=identify
endpoint=endpoint-messagenet
match=${MESSAGENET_SBC}
${
  altUri && altPassword && altUri !== uri
    ? `
; Registrazione secondaria MessageNet (numero di backup)
[auth-messagenet-alt]
type=auth
auth_type=userpass
username=${altUri}
password=${altPassword}

[reg-messagenet-alt]
type=registration
transport=transport-udp
client_uri=sip:${altUri}@${domain}
server_uri=sip:${domain}
contact_user=${altUri}
outbound_auth=auth-messagenet-alt
expiration=600
retry_interval=60
forbidden_retry_interval=300
max_retries=0
`
    : ''
}

; ---------------------------------------------------------------------------
; Uscita verso il SIP Domain Twilio (IVR)
; ---------------------------------------------------------------------------
[aor-twilio]
type=aor
contact=sip:centralino@${TWILIO_DOMAIN}
max_contacts=1
qualify_frequency=0

[endpoint-twilio]
type=endpoint
transport=transport-udp
context=from-twilio
disallow=all
allow=ulaw
allow=alaw
aors=aor-twilio
direct_media=no
force_rport=yes
rtp_symmetric=yes
ice_support=no
from_domain=${TWILIO_DOMAIN}
send_pai=yes

; ---------------------------------------------------------------------------
; Ingresso da Twilio (<Dial><Sip>) verso interni VoIP 101 / 102
; Identificato dall'header segreto X-MTI-Bridge + digest auth.
; ---------------------------------------------------------------------------
[auth-twilio-in]
type=auth
auth_type=userpass
username=${twilioBridgeUser}
password=${twilioBridgePass || 'CHANGE_ME'}

[endpoint-twilio-in]
type=endpoint
transport=transport-udp
context=from-twilio
disallow=all
allow=ulaw
allow=alaw
auth=auth-twilio-in
direct_media=no
force_rport=yes
rewrite_contact=yes
rtp_symmetric=yes
ice_support=no
trust_id_inbound=yes

[identify-twilio-in]
type=identify
endpoint=endpoint-twilio-in
match_header=X-MTI-Bridge: ${bridgeToken || 'CHANGE_ME'}

; ---------------------------------------------------------------------------
; Interni VoIP Yealink (${allPjsipExtensions.map((e) => `${e.ext} ${e.name}`).join(', ')})
; ---------------------------------------------------------------------------
${allPjsipExtensions.map((e) => buildExtension(e.ext, e.password, e.name)).join('\n')}
`;

const ringGroupList = (env.ASTERISK_RING_GROUP || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => voipExtensions.some((e) => e.ext === s));

const groupExtraList = (env.ASTERISK_GROUP_EXTRA || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => allPjsipExtensions.some((e) => e.ext === s));

const ringGroupTargets =
  groupAccount && groupAccountPass
    ? [groupAccount, ...groupExtraList.filter((e) => e !== groupAccount)]
        .map((ext) => `PJSIP/${ext}`)
        .join('&')
    : (ringGroupList.length ? ringGroupList : voipExtensions.map((e) => e.ext))
        .map((ext) => `PJSIP/${ext}`)
        .join('&');

const twilioExtDialplan = voipExtensions
  .map(
    (e) => `exten => ${e.ext},1,NoOp(Trasferimento IVR verso interno ${e.ext} from=\${CALLERID(num)})
 same => n,Gosub(apply-mti-caller,s,1)
 same => n,Dial(PJSIP/${e.ext},${dialTimeout},t)
 same => n,Hangup()`
  )
  .join('\n\n');

const internalExtDialplan = voipExtensions
  .map(
    (e) => `exten => ${e.ext},1,NoOp(Chiamata interna verso ${e.ext} da \${CALLERID(num)})
 same => n,Dial(PJSIP/${e.ext},30,tT)
 same => n,Hangup()`
  )
  .join('\n\n');

const extensions = `[general]
static=yes
writeprotect=no

; ---------------------------------------------------------------------------
; Ingresso da MessageNet -> IVR Twilio (risposta immediata zero squilli)
; ---------------------------------------------------------------------------
[from-messagenet]
exten => h,1,NoOp(Fine chiamata MessageNet)
 same => n,Hangup()
exten => _.,1,Answer()
 same => n,NoOp(MessageNet IN from=\${CALLERID(num)} to=\${EXTEN} did=\${CALLERID(dnid)})
 same => n,Set(__MTI_CALLER=\${CALLERID(num)})
 same => n,Set(__MTI_DID=\${CALLERID(dnid)})
 same => n,Set(__MTI_PAI=\${PJSIP_HEADER(read,P-Asserted-Identity)})
 same => n,Set(__MTI_RPID=\${PJSIP_HEADER(read,Remote-Party-ID)})
 same => n,Set(__MTI_DIV=\${PJSIP_HEADER(read,Diversion)})
 same => n,Set(__MTI_HIST=\${PJSIP_HEADER(read,History-Info)})
 same => n,Dial(PJSIP/endpoint-twilio,180,b(mti-headers^s^1))
 same => n,Hangup()

[mti-headers]
exten => s,1,Set(PJSIP_HEADER(add,X-MTI-Caller)=\${MTI_CALLER})
 same => n,Set(PJSIP_HEADER(add,X-MTI-Did)=\${MTI_DID})
 same => n,Set(PJSIP_HEADER(add,X-MTI-Pai)=\${MTI_PAI})
 same => n,Set(PJSIP_HEADER(add,X-MTI-Rpid)=\${MTI_RPID})
 same => n,Set(PJSIP_HEADER(add,X-MTI-Diversion)=\${MTI_DIV})
 same => n,Set(PJSIP_HEADER(add,X-MTI-History)=\${MTI_HIST})
 same => n,Return()

; ---------------------------------------------------------------------------
; Ingresso da Twilio (<Dial><Sip>) -> squillo sugli interni VoIP
; NON chiamare Answer() prima di Dial(), così Twilio riceve 180 Ringing
; e gestisce correttamente il timeout di mancata risposta.
; ---------------------------------------------------------------------------
[from-twilio]
exten => 100,1,NoOp(Trasferimento IVR verso gruppo 100 from=\${CALLERID(num)})
 same => n,Gosub(apply-mti-caller,s,1)
 same => n,Dial(${ringGroupTargets},${dialTimeout},t)
 same => n,Hangup()

${twilioExtDialplan}

exten => _.,1,NoOp(Destinazione Twilio non valida: \${EXTEN})
 same => n,Hangup()

[apply-mti-caller]
exten => s,1,Set(MTI_X_CALLER=\${PJSIP_HEADER(read,X-MTI-Caller)})
 same => n,Set(MTI_X_NAME=\${PJSIP_HEADER(read,X-MTI-CallerName)})
 same => n,GotoIf($["\${MTI_X_CALLER}" != ""]?setnum)
 ; Se il numero reale non e' disponibile (es. deviazione TIM), evita di mostrare
 ; il numero USA Twilio (+17089052752) e mostra il riferimento del centralino.
 same => n,Set(CALLERID(num)=067821202)
 same => n,Set(CALLERID(name)=Centralino)
 same => n,Return()
 same => n(setnum),Set(CALLERID(num)=\${MTI_X_CALLER})
 same => n,GotoIf($["\${MTI_X_NAME}" != ""]?setname)
 same => n,Set(MTI_X_NAME=\${MTI_X_CALLER})
 same => n(setname),Set(CALLERID(name)=\${MTI_X_NAME})
 same => n,Return()

; ---------------------------------------------------------------------------
; Chiamate dagli interni Yealink (${voipExtensions.map((e) => e.ext).join(', ')})
; ---------------------------------------------------------------------------
[from-internal]
; Gruppo di chiamata 100 -> squillano tutti
exten => 100,1,NoOp(Chiamata interna gruppo 100 da \${CALLERID(num)})
 same => n,Dial(${ringGroupTargets},30,tT)
 same => n,Hangup()

; Interni singoli
${internalExtDialplan}

; Emergenza Italia
exten => _11[2358],1,NoOp(Emergenza \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita verso numeri fissi italiani (0...)
exten => _0[1-9]X.,1,NoOp(Uscita fisso \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita verso cellulari italiani (3...)
exten => _3X.,1,NoOp(Uscita mobile \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita con prefisso +39 -> rimuove +39 (MessageNet vuole formato nazionale italiano)
exten => _+39X.,1,NoOp(Uscita IT E.164 \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN:3}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita con prefisso 0039 -> rimuove 0039 (MessageNet vuole formato nazionale italiano)
exten => _0039X.,1,NoOp(Uscita IT 0039 \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN:4}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita internazionale (00...)
exten => _00X.,1,NoOp(Uscita internazionale \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/\${EXTEN}@endpoint-messagenet,90,T)
 same => n,Hangup()

; Uscita con prefisso + estero -> converte + in 00 per MessageNet
exten => _+X.,1,NoOp(Uscita E.164 \${EXTEN} da \${CALLERID(num)})
 same => n,Set(CALLERID(num)=${outboundCli})
 same => n,Dial(PJSIP/00\${EXTEN:1}@endpoint-messagenet,90,T)
 same => n,Hangup()
`;

const features = `[general]
parkext => 700
parkpos => 701-704
context => parkedcalls
transferdigittimeout => 3
featuredigittimeout => 1500

[featuremap]
blindxfer => #1
atxfer => *2
disconnect => *0
`;

const rtp = `[general]
rtpstart=10000
rtpend=10100
rtpchecksums=no
strictrtp=no
`;

if (dryRun) {
  console.log(`Dry-run OK: letta env da ${ENV_FILE}`);
  console.log(`  MessageNet URI: ${uri}@${domain} (CLI uscita: ${outboundCli})`);
  console.log(
    `  Interni generati: ${voipExtensions.map((e) => `${e.ext} (${e.name})`).join(', ')}, gruppo 100 (timeout ${dialTimeout}s)`
  );
  process.exit(0);
}

for (const [name, content] of [
  ['pjsip.conf', pjsip],
  ['extensions.conf', extensions],
  ['features.conf', features],
  ['rtp.conf', rtp]
]) {
  const file = path.join(AST_DIR, name);
  backup(file);
  fs.writeFileSync(file, content, 'utf8');
  fs.chmodSync(file, 0o640);
  try {
    fs.chownSync(file, fs.statSync(AST_DIR).uid, fs.statSync(AST_DIR).gid);
  } catch {}
  console.log(`scritto ${file}`);
}

console.log('Configurazione Asterisk VoIP generata.');

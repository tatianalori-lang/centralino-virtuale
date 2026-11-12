import fs from 'node:fs';

// Genera la configurazione Asterisk per il ponte SIP MessageNet -> Twilio.
// Eseguire come root sul VPS: node /opt/centralino/scripts/genera-config-asterisk.mjs
// Le credenziali vengono lette da /opt/centralino/.env (permessi 600).

const ENV_FILE = '/opt/centralino/.env';
const AST_DIR = '/etc/asterisk';
const PUBLIC_IP = '91.99.150.162';
const MESSAGENET_SBC = '109.233.129.0/24';
const TWILIO_DOMAIN = 'mtitalia-centralino.sip.twilio.com';

const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
}

const uri = env.MESSAGENET_SIP_URI;
const password = env.MESSAGENET_SIP_PASSWORD;
const domain = env.MESSAGENET_SIP_DOMAIN || 'sip.messagenet.it';
if (!uri || !password) {
  console.error('Credenziali SIP MessageNet mancanti in .env');
  process.exit(1);
}

function backup(file) {
  if (fs.existsSync(file) && !fs.existsSync(`${file}.pre-centralino`)) {
    fs.copyFileSync(file, `${file}.pre-centralino`);
  }
}

const pjsip = `[global]
type=global
user_agent=CentralinoMTItalia
; Mantiene vivo il binding UDP verso MessageNet (evita registrazioni stale).
keep_alive_interval=30

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=${PUBLIC_IP}
external_signaling_address=${PUBLIC_IP}
local_net=127.0.0.1/32

; Registrazione verso MessageNet (numero +39 06 8635 8716)
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
; 600 s (invece di 3600): Asterisk rinnova il REGISTER ogni ~5 minuti,
; così MessageNet non scarta il contatto come inattivo.
expiration=600
retry_interval=60
forbidden_retry_interval=300
max_retries=0

[aor-messagenet]
type=aor
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
from_domain=${domain}
trust_id_inbound=yes

[identify-messagenet]
type=identify
endpoint=endpoint-messagenet
match=${MESSAGENET_SBC}

; Uscita verso il SIP Domain Twilio (autorizzato via IP ACL)
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
`;

const extensions = `[general]
static=yes
writeprotect=no

; Chiamata in ingresso da MessageNet: rispondiamo SUBITO (zero squilli)
; e la inoltriamo al SIP Domain Twilio che esegue il nostro IVR.
[from-messagenet]
exten => h,1,NoOp(Fine chiamata MessageNet)
 same => n,Hangup()
exten => _.,1,NoOp(MessageNet IN from=\${CALLERID(num)} to=\${EXTEN} did=\${CALLERID(dnid)})
 same => n,Set(CALLERID(num)=\${CALLERID(num)})
 same => n,Answer()
 same => n,Dial(PJSIP/endpoint-twilio,180)
 same => n,Hangup()

[from-twilio]
exten => _.,1,NoOp(Ingresso inatteso da Twilio)
 same => n,Hangup()
`;

const rtp = `[general]
rtpstart=10000
rtpend=10100
rtpchecksums=no
strictrtp=no
`;

for (const [name, content] of [
  ['pjsip.conf', pjsip],
  ['extensions.conf', extensions],
  ['rtp.conf', rtp]
]) {
  const file = `${AST_DIR}/${name}`;
  backup(file);
  fs.writeFileSync(file, content, 'utf8');
  fs.chmodSync(file, 0o640);
  try { fs.chownSync(file, fs.statSync(AST_DIR).uid, fs.statSync(AST_DIR).gid); } catch {}
  console.log(`scritto ${file}`);
}

console.log('Configurazione Asterisk generata.');

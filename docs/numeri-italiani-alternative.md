# Numeri italiani alternativi a Telnyx

Stato al 12/11/2026: ordine Telnyx `1bb70f5d-…` ancora `pending` /
`requirement-info-under-review`, 17/17 requisiti `pending-approval`, nessun
commento del Number Ops. **Non esiste una ETA** per l'Italia (Telnyx non
supporta la pre-approvazione dei requirement group per i numeri IT).

## Il vincolo comune (AGCOM)

Per un numero **geografico italiano (es. 06 Roma)** qualsiasi operatore chiede:

| Dato | Documento |
| --- | --- |
| Ragione sociale / P.IVA | Visura camerale |
| Codice fiscale legale rappresentante | Documento d'identità |
| Sede nel **distretto del prefisso** | Bolletta / visura con indirizzo |
| CAP del distretto | `00179` (Roma) |

⚠️ I numeri **mobili italiani non sono ammessi per la voce** da regolamento;
serve un numero fisso/geografico. Non esiste quindi l'attivazione "istantanea
senza documenti": la verifica richiede da 1 a 3 giorni lavorativi anche presso
gli operatori italiani più rapidi.

## Kit documenti già pronto (riutilizzabile)

Gli stessi dati inviati a Telnyx, da ricaricare su qualsiasi altro portale:

```
MT ITALIA SRLS
P.IVA / VAT:      15588261006 / IT15588261006
Codice Fiscale:   LROTTN76D63H501L
Legale rapp.:     Tatiana Lori (nata 23/04/1976)
Sede:             Via Marco Tabarrini 13, 00179 Roma (RM), Italia
Residenza:        Via Genzano 63, 00179 Roma (RM), Italia
Documenti:        visura.pdf, ci.pdf, bolletta_sorgenia.pdf
```

## Alternative

### A. Programmabili via API (più simili all'architettura attuale)

| Fornitore | Numero IT | Tempo | Costo indicativo | Integrazione |
| --- | --- | --- | --- | --- |
| **Vonage** (Voice API + NCCO) | Fisso, *on request* | **5-7 gg lavorativi** (SLA pubblicato) | su richiesta | Serve un adapter NCCO → nostro IVR (~1 giorno di lavoro) |
| **Sinch** (Voice / Number API) | Fisso | giorni, con KYC | canone + traffico | Adapter REST/webhook |
| **DIDWW** | DID geografico, SIP (IP o REGISTER) | online, con verifica documenti | canone | Serve ponte SIP sul VPS |
| **Twilio** | Numeri locali IT **non acquistabili self-service** per la voce; solo **portabilità** del numero esistente | **fino a 6 settimane** + Codice Segreto TIM + LOA | — | Nessuna modifica al codice (già TwiML) |

👉 Vonage è l'alternativa "drop-in" più credibile: ha un **tempo dichiarato**,
mentre Telnyx non ne fornisce uno.

### B. Operatori VoIP italiani (attivazione in ore/giorni, economici)

Danno un **account SIP** e spesso un centralino/inoltro incluso:

| Fornitore | Attivazione | Costo indicativo | Note |
| --- | --- | --- | --- |
| **V2VoIP** (v2voip.it) | ~**2 ore lavorative** | 24 €/anno + IVA | DID 06, inoltro sempre/occupato/nessuna risposta, 2 canali |
| **MessageNet** (messagenet.com) | «Subito attivo» | 15-45 €/mese | SIP pubblicato, guide Asterisk, portabilità gratuita |
| **OpenVoIP** (openvoip.it) | 24-48 h | 3 €/mese + traffico | Nessun costo di attivazione |
| **KaliVoice** (kalitek.it) | rapida | 30 € una tantum + 13 €/mese per canale | Tutti i prefissi, portabilità |
| **Ehiweb**, **Vohippo**, **Denali**, **DataKnowl** | 1-3 gg | 5-25 €/mese | Vohippo: verifica documenti 1-3 gg, flow di chiamata; DataKnowl: IVR + ticket inclusi |

⚠️ **Integrazione**: questi operatori consegnano il numero via **SIP**, non via
webhook HTTP. Per collegarli al nostro IVR serve uno di questi percorsi:

1. **Ponte SIP sul VPS** (Asterisk/FreeSWITCH) che risponde e inoltra gli eventi
   al backend HTTP → mantiene tutte le funzioni attuali (ticket, email,
   interventi, dashboard). Lavoro: ~1 giorno + un servizio in più da gestire.
2. **Inoltro sempre verso il numero Twilio** `+17089052752` → nessun codice,
   ma resta la tratta internazionale (quindi **restano gli squilli**).
3. **Usare il centralino/IVR dell'operatore** → si perdono ticket, email,
   dashboard e integrazione con Gestione Interventi. Sconsigliato.

### C. Stato finale adottato (12/11/2026)

| Scelta | Stato |
| --- | --- |
| `067821202` su TIM con **«Inoltro sempre»** verso `0686358716` | ✅ attivo |
| Portabilità di `067821202` su MessageNet | ❌ **scartata** su indicazione del cliente |
| Deviazioni MessageNet (condizionali 15 s → segreteria) | ✅ **disattivate** |

Con "sempre" gli squilli sono passati da **7 → 4**. I 4 residui non dipendono
dal centralino: MessageNet riceve la chiamata e l'IVR risponde **1 secondo**
dopo (verificato con i timestamp incrociati registro MessageNet / webhook
Twilio). Sono il **ringback generato da TIM** mentre stabilisce la chiamata
deviata: solo TIM (191 / portale Webex) può ridurli. Gli squilli non sono
azzerabili del tutto senza portabilità.

> `+39 06 8635 8716` (chiamata diretta) risponde in ~1 s con **zero squilli**:
> resta il numero da pubblicare se serve risposta immediata.

## Raccomandazione

1. **Numero principale da pubblicare**: `0686358716` → zero squilli, senza
   toccare TIM. `067821202` resta attivo come secondo numero.
2. **Mantieni l'ordine Telnyx**: è l'unica opzione già perfettamente integrata
   (TeXML → `/telnyx/voice`, zero modifiche), e il monitor avvisa appena
   approvano.
3. **Se serve un terzo numero indipendente da TIM**:
   - per **velocità**: V2VoIP o MessageNet + ponte SIP sul VPS;
   - per **compatibilità con il codice attuale**: Vonage (5-7 gg) + adapter NCCO.
4. **Portabilità di `067821202` su Twilio**: tecnicamente ideale (numero storico,
   TwiML nativo), ma ~6 settimane e Codice Segreto TIM: vedi
   [`portabilita-tim.md`](portabilita-tim.md).

## Procedura pratica: MessageNet

> ✅ **STATO: ATTIVO E VERIFICATO (12/11/2026)** — il numero
> **`+39 06 8635 8716`** risponde con l'IVR del centralino **senza squilli**.

### Architettura del ponte SIP

```
Chiamante → MessageNet (IT) --SIP--> Asterisk (VPS) --SIP--> Twilio SIP Domain → /twilio/voice → IVR
```

| Componente | Valore |
| --- | --- |
| Numero italiano | `+39 06 8635 8716` — SmartNumber PRO 1 |
| Registrazione SIP | `5406639544@sip.messagenet.it` → `200 OK`, expires 3600 |
| Asterisk | 20.6.0 sul VPS, `enabled` + `Restart=always` |
| SIP Domain Twilio | `mtitalia-centralino.sip.twilio.com` → webhook `/twilio/voice` |
| Autenticazione Twilio | IP ACL `91.99.150.162/32` |
| Firewall VPS | UDP 5060 solo da `109.233.129.0/24`; RTP 10000-10100 |
| Configurazione | generata da `scripts/genera-config-asterisk.mjs` leggendo `.env` (credenziali mai in chiaro nei file di codice) |
| Robustezza | `expiration=600` (rinnovo REGISTER ~ogni 5 min) + `keep_alive_interval=30` + `Restart=always`: evita il binding "stale" che faceva cadere l'IVR senza squilli |

**Verifica end-to-end con chiamata reale** (`+17089052752` → `+390686358716`):
Asterisk risponde immediatamente (`Answer()`), inoltra l'INVITE al SIP Domain
Twilio che risponde `200 OK` e chiama il webhook → **HTTP 200 in 474 ms** con il
TwiML `<Gather input="speech">…Buongiorno MT Italia…</Gather>`. Durata 25 s in
bridge. **Nessuno squillo generato dal lato italiano.**

Script di supporto in `deploy/`: `check-asterisk.sh`, `capture-sip.sh`,
`enable-sip-log.sh`, `finalizza-asterisk.sh`. `server.js` normalizza il `From`
in formato SIP (`phoneFromSip`) dopo la validazione della firma, così il numero
del chiamante resta corretto sul ticket.

> 📌 Il numero storico `067821202` resta attivo via TIM/Webex (con i suoi
> squilli). Per azzerarli **anche su quel numero** va portato su MessageNet
> (portabilità gratuita, 3-10 giorni lavorativi): a quel punto entrambe le
> numerazioni passano dal ponte SIP.

### 1. Acquisto (≈10 minuti, numero attivo subito)

1. Vai su **https://www.messagenet.com/voip/** → scegli **SmartNumber**
   (36,60 €/anno + 8,54 € di attivazione = **45,14 € primo anno**, 1 canale,
   chiamate in entrata incluse) oppure **SmartNumber Pro** (15 €/mese, flat).
2. Registrati come **Azienda** con il kit documenti qui sopra (MT ITALIA SRLS,
   P.IVA 15588261006, CF LROTTN76D63H501L, Tatiana Lori, visura, CI, bolletta).
3. In *Inserire un nuovo numero* scegli il prefisso **06 (Roma)**. MessageNet
   chiede un **domicilio coerente col distretto**: inserisci esattamente
   `Via Marco Tabarrini 13, 00179 Roma (RM)`. Verifica il CAP: se non combacia
   con il comune di Roma l'attivazione viene rifiutata.
4. Conferma e paga: il numero è **subito attivo** (help center MessageNet:
   «Proseguendo e dando conferma, il numero sarà subito attivo»).
5. Nel pannello → **Dettagli numero** → copia:
   - **Username / URI** (arriva anche via e-mail)
   - **Password** (pulsante "copia" accanto ai pallini)
   - Domain/Realm: `sip.messagenet.it`
   - SIP Proxy: `sip.messagenet.it` o `sip.messagenet.it:5061`

### 2. Alternativa: porta il numero che hai già

MessageNet offre la **portabilità gratuita** di `067821202` (3-10 giorni
lavorativi). Vantaggio: i clienti continuano a comporre lo stesso numero.
Svantaggio: non è "subito attivo".

### 3. Collegamento al centralino (a cura nostra, sul VPS)

MessageNet consegna il numero via **SIP**, non via webhook HTTP. Due strade:

| Strada | Lavoro | Squilli | Funzionalità |
| --- | --- | --- | --- |
| **A. Deviazione verso `+17089052752`** | 2 min, zero codice | restano 1-3 (tratta internazionale) | tutte, invariate |
| **B. Ponte SIP → Twilio SIP Domain** (consigliata) | ~1 giorno | **~0** | tutte, invariate |

**Strada B**: installo Asterisk sul VPS che si registra su `sip.messagenet.it`
con le credenziali; all'arrivo di una chiamata inoltra l'INVITE a un **Twilio SIP
Domain** (`…sip.twilio.com`) che creo via API puntando al nostro webhook
`/twilio/voice`. Twilio esegue quindi **lo stesso TwiML di oggi**, con lo stesso
riconoscimento vocale, ticket, email e collegamento agli interventi: nessuna
riscrittura dell'IVR. La chiamata termina in IP, senza passare dalla rete
PSTN internazionale → niente toni di libero lunghi.

Serve solo: le credenziali SIP MessageNet + via libera ad aprire sul firewall del
VPS le porte SIP/RTP (5060 UDP e range RTP). Il resto lo faccio io.

### 4. Cosa mandarmi

- Username/URI + password SIP (anche in chat, poi le ruoto)
- Se hai scelto la portabilità: data prevista di consegna
- Conferma se preferisci la strada A (immediata) o B (zero squilli)

> Se nel frattempo Telnyx approva `+390698237118`, quella resta la soluzione più
> pulita (TeXML nativo, zero ponti): MessageNet diventa un secondo numero o un
> backup.

## Nota sui documenti

Prima di acquistare, chiedi al fornitore **per iscritto** quali documenti
accetta per il distretto 06: alcuni vogliono la bolletta intestata alla sede,
altri accettano la visura. Il kit sopra è quello già validato da Telnyx come
"nothing is missing on your side".

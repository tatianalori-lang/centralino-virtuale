# Centralino Virtuale

Centralino telefonico con IVR in italiano basato su **Twilio**. Riceve le chiamate, raccoglie i dati del chiamante, il motivo della chiamata, il prodotto e la problematica, crea un ticket e lo mostra in una dashboard web.

Include anche un **simulatore di chiamata** nel browser per provare tutto il flusso senza configurare Twilio.

---

## Cosa raccoglie

| Dato | Come |
| --- | --- |
| Nome | Riconoscimento vocale |
| Azienda | Riconoscimento vocale (opzionale) |
| Telefono | Numero chiamante rilevato dal caller ID (mai il numero del centralino) |
| Motivo della chiamata | Menu DTMF (assistenza, commerciale, amministrazione, altro) |
| Prodotto/servizio | Richiesta generica a voce, testo libero (nessuna selezione da elenco) — solo per *Assistenza tecnica* |
| Problematica | Descrizione vocale libera |
| Priorità ticket | Predefinita a *Media* (modificabile dalla dashboard) |

Alla fine il centralino legge un riepilogo, chiede conferma, registra il ticket e offre il trasferimento a un operatore.

---

## Requisiti

- Node.js 18 o superiore
- Un account Twilio con un numero telefonico
- Un URL pubblico HTTPS raggiungibile da Twilio (in locale va bene **ngrok**)

---

## Avvio rapido

```bash
# 1. Installa le dipendenze
npm install

# 2. Copia la configurazione
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux

# 3. Avvia il server
npm start
```

Apri <http://localhost:3000> per la dashboard e <http://localhost:3000/prova.html> per il simulatore.

> Su Windows, se PowerShell blocca `npm`, usa `npm.cmd install` e `npm.cmd start`.

---

## Configurazione Twilio

### 1. Compila `.env`

```env
PUBLIC_BASE_URL=https://la-tua-url-pubblica
COMPANY_NAME=Assistenza Clienti ACME

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+390212345678
OPERATOR_PHONE_NUMBER=+393331234567
```

`OPERATOR_PHONE_NUMBER` è opzionale: se impostato, il chiamante può premere `1` a fine chiamata per parlare con un operatore.

### 2. Esponi il server in locale

Con ngrok:

```bash
ngrok http 3000
```

Copia l'URL HTTPS generato (es. `https://abc123.ngrok-free.app`) in `PUBLIC_BASE_URL` e riavvia il server.

> Storico: in precedenza il servizio girava su questo PC con ngrok
> (`https://acorn-detection-repair.ngrok-free.dev`) e un'attività pianificata
> SYSTEM prima del login. Ora il centralino è **24/7 su VPS Hetzner** e il task
> locale è disattivato: vedi [`docs/pc-spento.md`](docs/pc-spento.md).
>
> **URL attivo:** `https://centralino.mtitaliaretail.com` — VPS + Caddy/HTTPS +
> watchdog, nessun cambio nameserver (solo un record A su Aruba). Guide:
> [`docs/sempre-online.md`](docs/sempre-online.md),
> [**Hetzner CX21**](docs/hetzner.md), [**AWS**](docs/aws.md),
> [Cloudflare (non scelto)](docs/cloudflare-tunnel.md).

### 3. Collega il numero Twilio

Nella Console Twilio:

1. **Phone Numbers → Manage → Active numbers**
2. Seleziona il numero
3. In **Voice & Fax → A call comes in** scegli:
   - **Webhook**
   - URL: `https://la-tua-url-pubblica/twilio/voice`
   - Metodo: **HTTP POST**

Salva. Ora le chiamate al numero Twilio vengono gestite dal centralino.

> **Numeri italiani:** Twilio non vende numeri geografici italiani (`06…`) abilitati alla voce; i numeri mobile italiani sono solo SMS. Per un centralino italiano si usa un numero Twilio di un altro paese (es. USA `+1`) e si inoltra il numero italiano esistente a quello Twilio, tramite il gestore telefonico. Attenzione: se il numero italiano inoltra al numero Twilio, non attivare la modalità `inoltro` con destinazione lo stesso numero italiano, per evitare un loop di chiamate. Alternative a Telnyx (Vonage, V2VoIP, MessageNet, …), tempi, costi e kit documenti: [`docs/numeri-italiani-alternative.md`](docs/numeri-italiani-alternative.md).
>
> ✅ **Numero italiano attivo: `+39 06 8635 8716`** (MessageNet). Risponde con
> lo stesso IVR **senza squilli** grazie al ponte SIP: `MessageNet → Asterisk
> (VPS) → Twilio SIP Domain → /twilio/voice`. Dettagli e configurazione in
> [`docs/numeri-italiani-alternative.md`](docs/numeri-italiani-alternative.md).

#### Inoltro da linea fissa TIM

La deviazione va impostata **dalla linea fissa che si vuole deviare**, non da un cellulare. Codici TIM per il trasferimento incondizionato:

| Azione | Codice |
| --- | --- |
| Attiva verso il numero Twilio | `*21*0017089052752#` |
| Varianti se il codice non viene accettato | `*21*+17089052752#` oppure `*21*17089052752#` |
| Verifica stato | `*#21#` |
| Disattiva | `#21#` |

- Se la voce risponde «deviazione disattivata» dopo la verifica, l'attivazione non è andata a buon fine.
- Sulle linee fisse il `+` spesso non è accettato: usa `00` davanti al numero internazionale (`*21*0017089052752#`).
- Sulle linee **RTG / RTG+ADSL** il servizio *Trasferimento di chiamata* va prima attivato chiamando il **187** (costa circa 3 €/mese). Su FTTC/FTTE/FTTH e ISDN è già incluso.
- La conversazione deviata è a carico della linea che inoltra, secondo il proprio profilo tariffario; verifica con TIM che siano consentite le deviazioni verso numeri esteri.
- Mentre la deviazione non è attiva, il centralino virtuale resta raggiungibile chiamando direttamente `+1 708 905 2752` (dall'Italia serve il prefisso `+` o `00`).

Il pannello *Modalità centralino* della dashboard mostra il codice pronto e il pulsante **Copia codice**.

#### Squilli prima della risposta

Il centralino **risponde subito**: il webhook viene servito in ~0,4 s e, con
`DIAL_TIMEOUT_SECONDS=0`, non viene generato alcun `<Dial>` (nessuno squillo
aggiunto dal centralino). Se chi chiama `067821202` sente comunque diversi
squilli, questi arrivano **prima** che la chiamata raggiunga Twilio: sono i
toni di libero della tratta TIM Webex → numero internazionale USA.

Per azzerarli:

1. Impostare la **deviazione incondizionata immediata** (`*21*0017089052752#`),
   non «su non risposta»: con l'inoltro *su non risposta* la linea italiana
   squilla N volte prima di inoltrare. Verifica con `*#21#`.
2. Su TIM Webex / Webex Calling configurare **«Inoltro sempre»** sul numero,
   eliminando eventuali timer di squillo dell'auto-attendant.
3. Soluzione definitiva: quando Telnyx approva `+390698237118`, pubblicare
   quel numero italiano: risponde diretto, senza deviazione internazionale.

Non è possibile eliminare questi squilli dal codice del centralino: sono
generati dalla rete dell'operatore prima della risposta.

### 4. Verifica la firma (consigliato)

Con `VALIDATE_TWILIO_SIGNATURE=true` il server controlla l'header `X-Twilio-Signature` usando l'Auth Token. Assicurati che `PUBLIC_BASE_URL` corrisponda **esattamente** all'URL configurato in Twilio, altrimenti le richieste verranno rifiutate con `403`.

In sviluppo puoi disattivarla con `VALIDATE_TWILIO_SIGNATURE=false`.

---

## Numero italiano

Twilio **non vende** numeri geografici italiani con voce. Le strade sono due.

### Strada consigliata: Telnyx diretto, senza Twilio

Compri un numero `+39` su **Telnyx** e lo assegni a una **TeXML Application**
che punta a `https://TUO-URL/telnyx/voice`. TeXML è compatibile con TwiML:
l'IVR, i ticket e le email restano identici, ma **nessuna chiamata passa da Twilio**.

```
Chiamante → numero italiano Telnyx → /telnyx/voice → IVR + ticket + email
```

- Nessuna portabilità, nessun Codice Segreto TIM, nessun prefisso internazionale.
- Serve l'**API key v2 Telnyx** (`KEY_...`, non email/password) e un Requirement Group Italy con i documenti aziendali.
- Procedura completa: [`docs/numero-telnyx.md`](docs/numero-telnyx.md).
- Comandi: `npm run numero-telnyx -- cerca | app | stato`.

### Strada alternativa: numero italiano nuovo inoltrato a Twilio

Compri un numero `+39` da Telnyx/Vonage/Messagenet e lo inoltri a
`+1 708 905 2752`. Nessuna portabilità, ma la chiamata passa comunque dagli USA.
Dettagli: [`docs/numero-italiano-nuovo.md`](docs/numero-italiano-nuovo.md).

### Strada non consigliata: portabilità TIM → Twilio

Portando `ITALIAN_NUMBER` (default `067821202`) su Twilio, i clienti continuano a comporre lo stesso numero e l'IVR funziona senza modifiche al codice. Richiede però LOA, Codice Segreto TIM e fino a 6 settimane. Dettagli: [`docs/portabilita-tim.md`](docs/portabilita-tim.md).

| Cosa | Note |
| --- | --- |
| Lettera di Autorizzazione (LOA) | in italiano, datata entro 30 giorni |
| Codice Segreto | PIN richiesto a TIM per autorizzare la portabilità |
| Documentazione di compliance | ragione sociale, P.IVA, indirizzo, documento del legale rappresentante |
| Ultima fattura telefonica | copia |

- Richiesta: [International Porting Form](https://twlo.my.salesforce-sites.com/InternationalPorting)
- Operatori supportati: TIM, Fastweb, Vodafone, Wind, Tiscali, Colt, BT, Sky, TWT, Uno, Verizon, Voxbone, CloudItalia.

### Se il numero arriva su Twilio

Quando un numero `+39` compare nella Console Twilio, Collegalo all'IVR con:

```bash
npm run numero-italiano
```

Lo script imposta automaticamente `VoiceUrl`, `VoiceMethod` e lo status callback su `PUBLIC_BASE_URL`.

---

## Modalità centralino e inoltro

Il centralino ha due modalità:

| Modalità | Comportamento |
| --- | --- |
| `virtuale` | Le chiamate sono gestite dall'IVR: raccolta dati, ticket e conferma. |
| `inoltro` | Le chiamate vengono deviate direttamente a `FORWARD_NUMBER` (default `+39067821202`), senza passare dall'IVR. |

Il numero del centralino è `067821202`, configurato in `.env` come `CENTRALINO_NUMBER`.

### Comando

Con il server avviato (`npm start`), da un altro terminale:

```bash
npm run centralino -- status
npm run centralino -- virtuale
npm run centralino -- inoltro
npm run centralino -- numero +393331234567
npm run webhook
```

- `npm run webhook` aggiorna i webhook voce (Telnyx + Twilio) in base a `PUBLIC_BASE_URL`.

- `status` mostra modalità attiva, numero del centralino e numero di inoltro.
- `virtuale` attiva il centralino virtuale (IVR).
- `inoltro` devia tutte le chiamate al numero configurato.
- `numero` cambia il numero di destinazione dell'inoltro.

La scelta viene salvata in `data/settings.json` e resta attiva anche dopo il riavvio del server.

Se il server non è su `localhost:3000`, indica l'URL:

```bash
set CENTRALINO_URL=https://centralino.example.com
npm run centralino -- status
```

### Modalità solo voce

Con `IVR_INPUT=voice` (default) **nessun tasto è richiesto**: tutti i passi usano
`<Gather input="speech">` e il chiamante risponde parlando.

| Passo | Esempio di risposta parlata |
| --- | --- |
| Motivo | «assistenza tecnica», «informazioni commerciali», «amministrazione», «altro» |
| Prodotto/servizio | descrizione libera, es. «la bilancia del banco», oppure «salta» — solo per *Assistenza tecnica* |
| Conferma finale | «conferma», «ricomincia» |
| Dopo il ticket | «operatore» oppure «WhatsApp» |

Il riconoscimento accetta anche sinonimi e parole chiave («non lo so» → Altro,
«confermo» → Conferma). Il telefono del chiamante viene registrato
automaticamente dal caller ID, senza alcuna domanda; non viene più chiesta
l'urgenza e la priorità del ticket parte da *Media* (modificabile dalla
dashboard).

Impostando `IVR_INPUT=both` in `.env` si riabilitano anche i tasti DTMF come
fallback silenzioso (`input="dtmf speech"`, con i numeri nuovamente annunciati).
Lo stato attuale è visibile in `GET /api/telnyx/status` → `ivrInputMode`.

### Inoltro durante la chiamata

Il messaggio di benvenuto **non propone l'operatore**: il centralino raccoglie
prima i dati del chiamante. Senza essere annunciato, pronunciando
**"operatore"** in qualsiasi passo vocale la chiamata viene inoltrata a
`FORWARD_NUMBER` e viene comunque creato un ticket con i dati già raccolti.

Il tasto `0` funziona solo in modalità `IVR_INPUT=both`. A fine chiamata, dopo
il ticket, è offerta a voce la scelta tra «operatore» e «WhatsApp».

### Chiamate non completate

Il ticket viene aperto **anche se il chiamante interrompe la chiamata o non
arriva alla conferma finale**, con i dati raccolti fino a quel momento. Due
meccanismi indipendenti:

1. il callback di stato del provider (`/twilio/status`, `/telnyx/status`);
2. una rete di sicurezza interna: se una sessione resta inattiva per
   `IVR_ABANDON_SECONDS` (default 30 s) senza aver ancora generato un ticket,
   il ticket viene aperto comunque. Serve perché il **SIP Domain Twilio** del
   ponte MessageNet non invia i callback di stato.

Non vengono creati duplicati: se il ticket esiste già e il chiamante riprende
il dialogo, viene aggiornato con i dati completi (`completeTicket`).
I ticket di questo tipo hanno `reason: "Chiamata interrotta"` e la voce
«Chiamata interrotta: ticket aperto con i dati disponibili» nello storico.

### Dashboard

La dashboard mostra il pannello **Modalità centralino** con i pulsanti **Virtuale** / **Inoltro** e il campo per il numero di destinazione. Le modifiche fatte da CLI sono visibili ricaricando la pagina o premendo **Aggiorna ora**.

---

## Personalizzazione

### Motivi e prodotti

Modifica `config/catalog.json`:

```json
{
  "reasons": [
    { "key": "1", "value": "Assistenza tecnica" },
    { "key": "2", "value": "Informazioni commerciali" }
  ],
  "products": [
    { "key": "1", "value": "Software" },
    { "key": "2", "value": "Attrezzature" },
    { "key": "3", "value": "Bilance" },
    { "key": "4", "value": "Registratori di cassa" },
    { "key": "5", "value": "Cassetti automatici" }
  ]
}
```

Riavvia il server dopo la modifica. I menu vocali (motivo) e i filtri
della dashboard si aggiornano automaticamente.

> **Nota**: l'elenco `products` **non viene più usato come menu a scelta
> multipla nell'IVR**. Dopo *Assistenza tecnica* il centralino pone una
> **richiesta generica** («Mi dica su quale prodotto o servizio richiede
> assistenza, oppure dica salta.») e salva il testo libero nel campo
> `product` del ticket. L'elenco resta in `catalog.json` solo per il filtro
> «Prodotto» della dashboard, utile per i ticket storici.

### Nome azienda, voce e lingua

- `WELCOME_MESSAGE`: messaggio di benvenuto pronunciato all'inizio della chiamata (default `Buongiorno <COMPANY_NAME>`)
- `COMPANY_NAME`: nome azienda, usato come fallback del benvenuto e nel titolo della dashboard
- `TELNYX_VOICE` / `TWILIO_VOICE`: voce femminile italiana usata da `<Say>` (default `Polly.Bianca-Neural`); lo stesso valore è valido sia su Twilio sia su Telnyx TeXML
- `TWILIO_LANGUAGE` / `TELNYX_LANGUAGE`: lingua (default `it-IT`)
- `IVR_INPUT`: `voice` (default, solo voce) oppure `both` (voce + tasti DTMF)
- `IVR_ABANDON_SECONDS`: inattività (default 30 s, minimo 5) dopo cui una chiamata non completata apre comunque il ticket
- `TZ`: fuso orario per date e numerazione ticket

**Prova ad ascoltarla:** [`https://centralino.mtitaliaretail.com/ascolta-voce.html`](https://centralino.mtitaliaretail.com/ascolta-voce.html)
(oppure l'MP3 diretto `/audio/demo-voce-femminile.mp3`). Il campione contiene i
prompt reali dell'IVR, generati con la stessa voce. Per rigenerarlo:

```bash
npm run demo-voce
# oppure con un testo diverso
npm run demo-voce -- "Il tuo testo qui"
```

Lo script usa la REST API TTS di Telnyx: lì il formato della voce è
`AWS.Polly.Bianca-Neural` (in TeXML/TwiML è invece `Polly.Bianca-Neural`), ma è
la medesima voce.

### Email dei ticket

Alla creazione di ogni ticket il server invia un'email con tutti i dati raccolti (compreso l'indirizzo) a `MAIL_TO`, che di default è `assistenza@mtitaliaretail.com`.

Configura l'SMTP in `.env`. Esempio per una casella Aruba su dominio proprio (`mtitaliaretail.com`):

```env
SMTP_HOST=smtps.aruba.it
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=centralino@mtitaliaretail.com
SMTP_PASS=...
MAIL_FROM=centralino@mtitaliaretail.com
MAIL_TO=assistenza@mtitaliaretail.com
```

- Aruba richiede l'autenticazione con l'**indirizzo email completo** e la password della casella; la configurazione SSL usa la porta 465 e TLS 1.2.
- `MAIL_FROM` deve essere una casella Aruba esistente (oppure un mittente alternativo abilitato nella Webmail).
- Per altri provider: `SMTP_SECURE=true` per la porta 465 (SSL), `false` per 587 con STARTTLS.
- Se mancano `SMTP_HOST`, `SMTP_USER` o `SMTP_PASS`, il ticket viene comunque creato e salvato, ma l'email non parte. L'esito viene registrato nella cronologia del ticket.
- Verifica la configurazione con `GET /api/mail/status`.

### WhatsApp (alternativa all'email)

Il centralino può inviare il riepilogo del ticket anche via **WhatsApp**, usando
l'API di Telnyx (nessun passaggio da Twilio). A fine chiamata il chiamante può
premere **2** per ricevere il riepilogo sul proprio numero.

```env
NOTIFY_CHANNEL=email        # email | whatsapp | both
WHATSAPP_ENABLED=true
WHATSAPP_FROM=+39067821202  # numero WhatsApp Business aziendale (067821202)
WHATSAPP_TO=+39067821202    # destinatario dei ticket
WHATSAPP_TO_CALLER=false    # true = invia al numero del chiamante
WHATSAPP_TEMPLATE_NAME=     # template approvato, se serve
WHATSAPP_TEMPLATE_LANGUAGE=it
```

- Richiede `TELNYX_API_KEY` e un numero WhatsApp Business approvato su Telnyx.
- I messaggi liberi sono consentiti solo entro la finestra di 24h dall'ultimo messaggio del cliente; fuori serve un **template approvato** (`WHATSAPP_TEMPLATE_NAME`).
- `NOTIFY_CHANNEL=whatsapp` disattiva l'email, `both` invia entrambi.
- L'esito viene registrato nella cronologia del ticket.
- Verifica con `GET /api/whatsapp/status`.

### Testi del dialogo

I prompt e la logica dei passi sono in `lib/flow.js`. Puoi modificare le frasi, aggiungere passi o cambiare le regole di validazione.

---

## Dashboard

La dashboard mostra:

- statistiche (totale, nuovi, in lavorazione, chiusi, alta priorità)
- elenco ticket con ricerca e filtri per stato, motivo e prodotto
- dettaglio completo con problematica, note interne e cronologia
- cambio stato, priorità e operatore assegnato
- esportazione CSV (rispetta i filtri attivi)
- aggiornamento automatico ogni 5 secondi

I ticket sono salvati in `data/tickets.json` (creato al primo utilizzo). Il file è escluso da Git.

---

## API

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| GET | `/api/health` | Stato del server |
| GET | `/api/meta` | Motivi, prodotti, stati e priorità |
| GET | `/api/twilio/status` | Verifica configurazione Twilio |
| GET | `/api/telnyx/status` | Verifica configurazione Telnyx / numero italiano |
| GET | `/api/whatsapp/status` | Verifica configurazione notifiche WhatsApp |
| GET | `/api/mail/status` | Verifica configurazione email dei ticket |
| GET | `/api/modalita` | Modalità attiva e numeri di centralino/inoltro |
| POST | `/api/modalita` | Imposta `mode` (`virtuale`/`inoltro`) e `number` |
| GET | `/api/stats` | Statistiche ticket |
| GET | `/api/tickets` | Elenco con filtri `?q=&status=&reason=&product=` |
| GET | `/api/tickets/:id` | Dettaglio ticket |
| PATCH | `/api/tickets/:id` | Aggiorna `status`, `priority`, `assignee`, `note` |
| DELETE | `/api/tickets/:id` | Elimina ticket |
| GET | `/api/export.csv` | Esporta CSV con gli stessi filtri |
| POST | `/api/simulate/start` | Avvia simulazione |
| POST | `/api/simulate/answer` | Invia risposta alla simulazione |
| POST | `/twilio/voice` | Webhook chiamata in entrata Twilio |
| POST | `/twilio/voice/step` | Gestione risposte IVR Twilio |
| POST | `/twilio/voice/transfer` | Trasferimento a operatore Twilio |
| POST | `/twilio/status` | Callback di stato Twilio |
| POST | `/telnyx/voice` | Webhook TeXML in entrata (numero italiano) |
| POST | `/telnyx/voice/step` | Risposte IVR TeXML |
| POST | `/telnyx/voice/transfer` | Trasferimento a operatore TeXML |
| POST | `/telnyx/status` | Callback di stato Telnyx |

Esempio di aggiornamento ticket:

```bash
curl -X PATCH http://localhost:3000/api/tickets/TK-20261109-0001 \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"in_lavorazione\",\"assignee\":\"Mario\",\"note\":\"Richiamato il cliente\"}"
```

---

## Flusso della chiamata

```
Chiamata in entrata (modalità `voice`: solo voce, nessun tasto)
  → se modalità = inoltro: chiamata deviata subito al centralino
  → altrimenti:
     → Benvenuto + motivo (voce)
     → richiesta generica su prodotto/servizio (voce, testo libero) — SOLO se il motivo è "Assistenza tecnica";
       per Informazioni commerciali, Amministrazione e fatturazione e Altro
       il passo viene saltato e il campo prodotto resta vuoto
     → problematica (voce)
     → nome (voce)
     → nome della società (voce)
     → indirizzo postale (voce)
     → telefono del chiamante: registrato automaticamente dal caller ID
     → riepilogo + conferma (voce)
     → creazione ticket
     → invio email del ticket a assistenza@mtitaliaretail.com
     → a voce: «operatore» o «WhatsApp»
```

Il benvenuto **non annuncia più la possibilità di parlare con un operatore**:
il centralino procede con la raccolta dei dati. Con `IVR_INPUT=both` i menu
tornano `dtmf speech` e i tasti sono di nuovo utilizzabili/annunciati.

Se il chiamante non risponde due volte a un passo, il centralino usa un valore predefinito e prosegue, così la chiamata non si blocca.

### Collegamento agli interventi tecnici

Ogni ticket telefonico diventa una **scheda di intervento tecnico**, non un
promemoria. Il tipo e lo stato vengono risolti dai metadati OSM:

| Campo | Valore scelto | Escluso |
| --- | --- | --- |
| Tipo | «Settore tecnico» (id `1`) | tipi commerciali / di verificazione |
| Stato | «1 DA PROGRAMMARE» (id `2`) | **«8 PROMEMORIA» (id `9`)**, stati chiusi e completati |

Il testo della richiesta è una scheda strutturata (`SCHEDA DI INTERVENTO
TECNICO · Ticket …`, chiamante, azienda, telefono, indirizzo, motivo,
prodotto, priorità, problematica). Se i default OSM cambiassero, il centralino
continua a scegliere un tipo tecnico e uno stato aperto; se non li trova
**non crea l'intervento** piuttosto che creare un promemoria. Per forzare ID
diversi usare `INTERVENTI_TIPO_ID` e `INTERVENTI_STATO_ID` (anche questi non
possono puntare a «PROMEMORIA»).

**La chiamata si apre da sola su OSM**: non appena una chiamata produce un ticket
telefonico (`source: telefono`), il centralino crea l'intervento su *Gestione
Interventi* **in background**, senza click e senza far attendere il chiamante, e
salva sul ticket `intervento.{id,codice,url}`. Vale per **tutte le chiamate
reali**, di qualunque motivo: IVR completato, richiesta operatore e inoltro
diretto (`source: telefono` e `inoltro`). È escluso solo il simulatore
(`source: simulazione`), che non è una chiamata. L'esito
(intervento aperto o errore) viene registrato nella cronologia del ticket.

Il cliente viene associato solo con una corrispondenza esatta; **se non si trova,
la chiamata viene aperta sull'anagrafica `CENTRALINO`** (id `6830`), configurata
con `INTERVENTI_DEFAULT_CLIENTE`. L'intervento riporta la nota «Cliente non
identificato» così può essere riassegnato in seguito. Solo se manca anche il
fallback l'apertura non avviene e viene proposta la rosa di candidati
(`422 needCliente`) dal pulsante/CLI manuale.

Anche la sezione «Centralino» dell'app *Gestione Interventi* usa lo stesso
comportamento: `OSM_DEFAULT_ID_CLIENTE=6830` e match anagrafico esatto. I ticket
che hanno già un `intervento` risultano «Inviati» in entrambe le viste, evitando
doppioni. Il pulsante **«Apri intervento»** e la CLI restano utili solo per
recuperare ticket storici o riprovare dopo un errore.

```bash
npm run apri-intervento -- TK-20261111-0001            # mostra i clienti candidati
npm run apri-intervento -- TK-20261111-0001 1          # apre con il cliente id 1
npm run apri-intervento -- TK-20261111-0001 1 --dry-run # verifica il payload
```

Configurazione (`.env`): `INTERVENTI_URL`, `INTERVENTI_USERNAME`,
`INTERVENTI_PASSWORD`, `INTERVENTI_DEFAULT_CLIENTE` (id dell'anagrafica di
fallback, es. `6830` = CENTRALINO), `INTERVENTI_TIPO_ID` / `INTERVENTI_STATO_ID`
(opzionali, forzano tipo e stato della scheda tecnica) e `INTERVENTI_AUTO_OPEN` (default `true`:
apre la chiamata da solo; impostare a `false` per eseguire test contro il VPS
senza scrivere su OSM). **Se le credenziali mancano l'integrazione è
disattivata**, quindi nessun intervento viene creato durante i test. L'API è
`POST /api/tickets/:id/intervento` (anti-duplicato: `409` se già collegato;
`422 needCliente` solo se manca anche il fallback). Stato:
`/api/interventi/status` (espone `defaultCliente` e `autoOpen`).

### Conferma, dati e inoltro

- **Nessun dato del chiamante viene riletto**: il riepilogo chiede solo la
  conferma («La sua richiesta è pronta. Dica conferma…») e il messaggio finale
  comunica soltanto il numero di ticket e «Sarà contattato al più presto».
- **«Salta»**: su qualsiasi domanda di dati (problematica, nome, società,
  indirizzo) il chiamante può dire *salta*. Il campo assume il valore
  predefinito (`Non specificata`, `Non fornito`, vuoto per i campi facoltativi).
  Il CAP **non viene richiesto**.
- **Richiesta generica sul prodotto/servizio**: posta solo se il motivo è
  *Assistenza tecnica*, senza elenco né selezione di prodotti. Il chiamante
  risponde a parole sue (o dice *salta*) e il testo libero viene salvato nel
  campo `product` del ticket: «Mi dica su quale prodotto o servizio richiede
  assistenza, oppure dica salta.».
- **Inoltro al centralino**: `DIAL_TIMEOUT_SECONDS=0` → **nessuno squillo** verso
  il centralino. La richiesta viene registrata e al chiamante si comunica
  «Sarà contattato al più presto». Con un valore > 0 (es. `15`) si riattiva il
  trasferimento con quel tempo di attesa. Vale per tasto 0, richiesta
  «operatore» e modalità inoltro diretto.

---

## Sicurezza e produzione

- Mantieni `VALIDATE_TWILIO_SIGNATURE=true` in produzione.
- Non committare `.env`: contiene l'Auth Token Twilio.
- Usa HTTPS e un dominio stabile al posto di ngrok.
- I dati dei ticket sono in chiaro in `data/tickets.json`: valuta un database e una policy di conservazione se gestisci dati personali reali.
- Limita l'accesso alla dashboard (es. reverse proxy con autenticazione) prima di esporla su Internet.
- Per volumi elevati sostituisci lo store JSON con un database (PostgreSQL, SQLite, ecc.).

---

## Risoluzione problemi

**Twilio risponde 403**
La firma non corrisponde. Controlla che `PUBLIC_BASE_URL` sia identico all'URL del webhook Twilio (schema, dominio, percorso). In sviluppo puoi impostare `VALIDATE_TWILIO_SIGNATURE=false`.

**Non parte il benvenuto**
Verifica che il webhook del numero Twilio punti a `/twilio/voice` con metodo POST e che il server sia raggiungibile da Internet.

**Il riconoscimento vocale sbaglia i nomi**
È normale per nomi propri, email e termini tecnici. Il ticket riporta quanto trascritto; l'operatore può correggerlo nelle note. Per maggiore precisione valuta Twilio Speech Recognition enhanced o la raccolta via tastiera.

**La dashboard non si aggiorna**
Controlla la console del browser e che il server sia in esecuzione. L'aggiornamento automatico è attivo se la spunta "Aggiorna ogni 5s" è selezionata.

**Il centralino non riceve chiamate dall'esterno**
Controlla che `ngrok` sia in esecuzione (`ngrok http 3000`) e che il webhook Telnyx/Twilio punti a `https://acorn-detection-repair.ngrok-free.dev`. L'URL è il dev domain statico dell'account e non cambia al riavvio; se usi un altro account ngrok o un dominio diverso, aggiorna `PUBLIC_BASE_URL` in `.env`, riavvia il server e riesegui `npm run numero-telnyx -- app`.

---

## Struttura del progetto

```
.
├── server.js              # Server Express, API e webhook Twilio
├── config/
│   └── catalog.json       # Motivi e prodotti (filtro dashboard)
├── lib/
│   ├── config.js          # Lettura .env e catalogo
│   ├── callerId.js        # Risoluzione del numero del chiamante (SIP)
│   ├── flow.js            # Passi del dialogo e interpretazione risposte
│   ├── ivr.js             # TwiML e sessioni telefoniche
│   ├── simulator.js       # Motore del simulatore web
│   ├── signature.js       # Verifica firma Twilio
│   ├── mailer.js          # Invio email dei ticket
│   ├── whatsapp.js        # Invio riepilogo WhatsApp (Telnyx)
│   ├── telnyxSignature.js # Verifica firma webhook Telnyx
│   └── store.js           # Persistenza ticket su JSON
├── public/
│   ├── index.html         # Dashboard
│   ├── app.js
│   ├── styles.css
│   ├── prova.html         # Simulatore
│   └── prova.js
├── cloudflared/
│   └── config.yml         # Configurazione tunnel (opzione non scelta)
├── deploy/                 # Kit VPS per il 24/7 (install.sh, Caddyfile, systemd)
├── scripts/
│   ├── centralino.mjs      # Comando modalità virtuale/inoltro
│   ├── numero-italiano.mjs # Collega il numero italiano portato su Twilio
│   ├── numero-telnyx.mjs   # Gestione numero italiano Telnyx (cerca/app/stato/compra/assegna)
│   ├── aggiorna-webhook.mjs# Aggiorna webhook Telnyx + Twilio
│   ├── pc-spento.mjs       # Fallback inoltro chiamate (richiede upgrade Telnyx)
│   ├── avvia-tutto.ps1     # Avvio manuale server + ngrok (sessione utente)
│   ├── installa-avvio.ps1  # Crea il task SYSTEM pre-login (come admin)
│   ├── verifica-avvio.ps1  # Verifica il task (come admin)
│   ├── verifica-flusso.mjs # Test flusso IVR, ticket e caller ID (`npm run verifica`)
│   └── avvia-tunnel.ps1    # Avvia il Cloudflare Tunnel (opzione non scelta)
├── docs/                   # Guide numero italiano, portabilità, PC spento, Cloudflare
├── data/                   # Ticket e impostazioni (generato)
├── .env.example
└── package.json
```

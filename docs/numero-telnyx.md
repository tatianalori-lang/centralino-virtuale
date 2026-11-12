# Numero italiano diretto con Telnyx (senza Twilio)

Obiettivo: un numero **+39** che risponde con il centralino virtuale, senza
passare da Twilio e senza portabilità.

## Architettura

```
Chiamante → numero italiano Telnyx
          → TeXML webhook https://TUO-URL/telnyx/voice
          → IVR «Buongiorno MT Italia» → ticket + email Aruba
```

Telnyx **TeXML** è compatibile con TwiML: `<Response>`, `<Say>`, `<Gather>`,
`<Dial>` e `<Hangup>` funzionano con gli stessi parametri. Il backend riutilizza
lo stesso motore di dialogo (`lib/flow.js`) e lo stesso store dei ticket.

## Endpoint del backend

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| POST | `/telnyx/voice` | Webhook voce in entrata |
| POST | `/telnyx/voice/step` | Risposte DTMF / voce |
| POST | `/telnyx/voice/transfer` | Trasferimento a operatore |
| POST | `/telnyx/status` | Callback di stato |
| GET | `/api/telnyx/status` | Stato configurazione |

Nel portale Telnyx crea una **TeXML Application** con:

```
Voice URL:   https://TUO-URL/telnyx/voice
Metodo:      POST
```

e assegnale il numero italiano.

## Stato attuale dell'account Telnyx

| Elemento | Valore |
| --- | --- |
| API key | configurata in `.env` (`TELNYX_API_KEY`) |
| Saldo | 10,00 USD (dopo ricarica) |
| App TeXML | `3089354950187156880` — «Centralino Virtuale MT Italia» |
| Webhook voce | `https://acorn-detection-repair.ngrok-free.dev/telnyx/voice` |
| Requirement Group Italy | `a3e80b38-127e-40e6-b0bd-6519fde3d102` — `unapproved` ma **17/17 compilato** |
| Documenti | `visura.pdf`, `ci.pdf`, `bolletta_sorgenia.pdf` |
| Numero acquistato | **`+390698237118`** (Roma 06) |
| Ordine | `1bb70f5d-c9a2-45d9-a99a-5eb771c2046a` — `pending` |
| Assegnazione | `connection_id` = app TeXML (fatto) |

⚠️ Al momento il numero è in **`requirement-info-under-review`**: Telnyx sta
verificando i documenti. Quando lo stato passa ad attivo, le chiamate al
`+390698237118` raggiungono direttamente l'IVR (senza Twilio).

### URL pubblico

`https://acorn-detection-repair.ngrok-free.dev` è il **dev domain statico**
dell'account ngrok: non cambia al riavvio del tunnel (verificato). Basta che il
processo `ngrok http 3000` resti attivo.

Per un servizio indipendente dal PC, si può usare un dominio proprio
(es. `centralino.mtitaliaretail.com`) con Cloudflare Tunnel o un VPS: vedi
[`docs/cloudflare-tunnel.md`](cloudflare-tunnel.md). In quel caso aggiorna
`PUBLIC_BASE_URL` in `.env`, riavvia il server e lancia `npm run webhook`
(aggiorna sia l'app TeXML Telnyx sia il numero Twilio).

## Cosa serve

| Cosa | Chi |
| --- | --- |
| Account Telnyx + metodo di pagamento | tu |
| **API key v2** (`KEY_...`) | tu: Mission Control Portal → API Keys → Create API Key |
| Requirement Group "Italy" con documenti (visura/P.IVA, documento del legale rappresentante, prova di indirizzo) | tu: obbligatorio per i numeri italiani dal 2024 |
| Acquisto del numero `+39` | tu dal portale (o io con `--compra`, dopo i documenti) |
| Creazione app TeXML e assegnazione numero | **io**, con la API key |
| `TELNYX_PHONE_NUMBER` e `TELNYX_API_KEY` in `.env` | io |

⚠️ **Email e password del portale non servono**: le API Telnyx usano solo il
bearer token `KEY_...`. Non incollare la password nel codice o nei file di
configurazione.

## Comandi

```bash
npm run numero-telnyx -- cerca      # saldo + numeri Roma disponibili (solo lettura)
npm run numero-telnyx -- app        # crea/aggiorna l'app TeXML con il webhook
npm run numero-telnyx -- stato      # numeri, app e requirement group
npm run numero-telnyx -- requisiti  # dettaglio dei 17 requisiti KYC
npm run numero-telnyx -- compra +390698237118   # acquista (esplicito)
npm run numero-telnyx -- assegna +390698237118  # assegna all'app TeXML
```

## Il Requirement Group (blocco attuale)

Telnyx richiede **17 requisiti** per un numero locale italiano: 3 documenti PDF
e 14 campi testuali/indirizzo. Vanno compilati nel portale Telnyx
(**Numbers → Requirement Groups**) e poi inviati per approvazione:

| Tipo | Cosa |
| --- | --- |
| Documento | prova dell'indirizzo italiano (bolletta/estratto conto, < 3 mesi) |
| Documento | copia a colori di un documento d'identità valido del legale rappresentante |
| Documento | visura / certificato di iscrizione al Registro Imprese |
| Testo | ragione sociale, P.IVA, codice fiscale, tipo cliente (`legal_entity`) |
| Testo | nome, data e luogo di nascita del legale rappresentante |
| Testo | tipo, numero, autorità e scadenza del documento d'identità |
| Testo | email di contatto |
| Indirizzo | sede legale + residenza del legale rappresentante |

Dati già noti da Twilio: *mt italia srls*, Via Marco Tabarrini 13, 00179 Roma (RM),
Lazio, `tatianalori@mtitaliaretail.com`. Mancano P.IVA, codice fiscale, dati del
documento e i PDF.

Solo dopo aver compilato tutti i 17 requisiti si può acquistare il numero.
**L'Italia non supporta la pre-approvazione**: il gruppo resta `unapproved`, ma è
comunque utilizzabile per l'ordine (la review avviene sull'ordine stesso).
L'acquisto richiede il comando esplicito `compra`.

## Sicurezza dei webhook

Imposta `TELNYX_PUBLIC_KEY` (chiave Ed25519 del portale) in `.env` per
validare gli header `telnyx-timestamp` e `telnyx-signature-ed25519`.
Senza chiave i webhook sono accettati senza verifica: ok in sviluppo, da
evitare in produzione.

## Verifica finale

1. Chiama il numero italiano: deve rispondere «Buongiorno MT Italia».
2. Controlla il ticket su `http://localhost:3000`.
3. Controlla l'email su `assistenza@mtitaliaretail.com`.

## Nota

Il numero Twilio `+1 708 905 2752` può restare attivo come fallback, ma non è
più coinvolto nel percorso del numero italiano.

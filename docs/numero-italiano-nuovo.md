# Numero italiano nuovo inoltrato a Twilio (alternativa)

> **Consigliato invece:** [`docs/numero-telnyx.md`](numero-telnyx.md) — numero
> italiano gestito direttamente da Telnyx, **senza passare da Twilio**.

Obiettivo: avere un numero **+39** che i clienti possono chiamare, senza toccare la
linea TIM e senza portabilità, inoltrando però le chiamate al numero Twilio USA.

## Come funziona

```
Chiamante → numero italiano nuovo (provider VoIP)
          → inoltro di chiamata → +1 708 905 2752 (Twilio)
          → IVR «Buongiorno MT Italia» → ticket + email
```

Il centralino virtuale **non cambia**: nessuna modifica al codice, nessun Codice
Segreto TIM, nessuna deviazione sulla linea fissa, nessun 187.

## Perché serve un altro provider

Twilio non vende numeri geografici italiani con voce. I provider che li vendono:

| Provider | Note |
| --- | --- |
| **Telnyx** | numeri locali IT con voce, requirement groups obbligatori (documenti aziendali) |
| **Vonage** | numeri locali IT con voce, verifica indirizzo, 5-7 giorni lavorativi |
| **Messagenet / CloudTalk / Ringover** | numeri italiani VoIP con inoltro, attivazione in 1-2 giorni |

## Cosa serve

| Cosa | Chi lo fa |
| --- | --- |
| Account sul provider + metodo di pagamento | tu |
| KYC: visura/P.IVA, documento del legale rappresentante, indirizzo italiano | tu (i dati sono già noti: mt italia srls, Via Marco Tabarrini 13, 00179 Roma) |
| Acquisto del numero | posso farlo io se mi passi le chiavi API del provider |
| Regola «inoltro tutte le chiamate → `+17089052752`» | posso farlo io via API o dal pannello |
| Aggiornare `ITALIAN_NUMBER` e `CENTRALINO_NUMBER` in `.env` | posso farlo io |

Tempi indicativi: **1-7 giorni**. Costo: canone mensile del numero + traffico
verso gli USA (pochi cent/min, a carico del provider italiano).

## Verifica dopo l'attivazione

1. Chiama il nuovo numero italiano: deve rispondere «Buongiorno MT Italia».
2. Controlla che compaia un ticket su `http://localhost:3000`.
3. Controlla l'email su `assistenza@mtitaliaretail.com`.

## Alternativa più pulita (più lavoro)

Adattare il backend a **Telnyx TeXML** o **Vonage NCCO**: il numero italiano
sarebbe ospitato direttamente dal provider, senza hop internazionale. Richiede
riscrivere il layer di rendering TwiML, ma elimina il costo della tratta USA.

## Se il numero arriva comunque su Twilio

Se in futuro il numero `+39` comparisse sull'account Twilio (acquisto diretto o
portabilità), collega all'IVR con:

```bash
npm run numero-italiano
```

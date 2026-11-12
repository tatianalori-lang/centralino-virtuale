# Richiesta a TIM / amministratore Webex — numero del chiamante e squilli

**Data:** 12 novembre 2026
**Linea:** `067821202` (TIM / Webex Calling)
**Deviazione attiva verso:** `0686358716` (MessageNet → centralino virtuale)

## Il problema

Oggi le chiamate che arrivano al centralino portano **sempre** il numero della
linea deviata (`+39067821202`) al posto del numero di chi chiama, e il chiamante
sente diversi squilli prima della risposta.

Causa accertata (INVITE SIP catturato sul VPS):

```
From: "+39067821202" <sip:+39067821202@sip.messagenet.it>
To:   <sip:0686358716@10.100.102.98:5060>
```

Nessun header `Diversion`, `History-Info`, `P-Asserted-Identity` o
`Remote-Party-ID` con il numero originale: l'informazione viene persa **prima**
di arrivare al centralino. Dal codice non è recuperabile.

## Richiesta (testo pronto da inoltrare all'assistenza TIM / 191)

> Gentili,
>
> sulla linea **067821202** chiediamo di modificare la deviazione verso
> **0686358716** come segue:
>
> 1. impostare **«Inoltro sempre» / incondizionato immediato** (non «su non
>    risposta»), rimuovendo il numero di squilli prima dell'inoltro;
> 2. **presentare il CLI del chiamante originale** sulla chiamata deviata,
>    invece del numero della linea `067821202`;
> 3. segnalare la chiamata come **deviata** (header `Diversion` / `History-Info`),
>    così MessageNet può accettare un CLI non geografico (es. cellulare);
> 4. verificare che non ci siano timer di squillo dell'auto-attendant / Webex
>    Calling che ritardino l'inoltro.
>
> Oggi il centralino riceve sempre `+39067821202` come chiamante e il cliente
> sente ~4 squilli prima della risposta. Con la modifica il numero del chiamante
> deve arrivare corretto e la risposta deve essere immediata (~1 s).
>
> Grazie.

## Note tecniche per l'amministratore Control Hub

In **Control Hub** → *Management → Users* → utente della linea → *Calling*:

- **Call forwarding** → selezionare **Forward all calls** verso `0686358716`.
  Non usare *Forward calls when unanswered*: è quella che imposta
  «Number of rings before forwarding» e genera gli squilli.
- Verificare le impostazioni **Caller ID** / *Connected Line Identity for
  Redirected Calls*: deve essere mantenuta l'identità del **chiamante
  originario**, non quella della linea che inoltra.
- Se la deviazione è configurata sul portale Webex/Cloud Connected PSTN,
  chiedere a TIM di abilitare la presentazione del CLI originale sulla tratta
  deviata (alcuni profili TIM lo disabilitano di default).

## Cosa cambia sul centralino

**Niente**: il codice è già pronto. `lib/callerId.js` prende il primo numero
valido dagli header SIP (`X-MTI-Caller`, `From`, ...) e scarta solo i numeri
propri (centralino, account MessageNet, Twilio, Telnyx). Non appena la rete
passa il numero vero, il ticket lo mostra automaticamente, senza domande al
chiamante.

## Verifica dopo la modifica di TIM

1. Fare una chiamata di prova **da un cellulare** al `067821202`.
2. Sul VPS:

   ```bash
   journalctl -u centralino --no-pager | grep '\[CallerID\]' | tail -5
   ```

   Deve comparire il numero del cellulare tra i `candidati` e **non** il
   messaggio «scartati +39067821202».
3. Aprire la dashboard e controllare che il campo **Telefono** del nuovo ticket
   contenga il numero del cellulare.
4. Controllare che la risposta arrivi senza squilli.

## Alternativa senza attendere TIM

Il numero **0686358716** (MessageNet, chiamata diretta) già oggi:

- conserva il numero del chiamante,
- risponde in ~1 s con **zero squilli**.

Pubblicandolo come numero principale si ottiene lo stesso risultato senza
modifiche alla linea TIM.

## Fallback non adottato

In caso TIM non possa passare il CLI originale, è possibile leggere il numero
dallo storico chiamate Webex con un token API
(`scripts/webex-cdr.mjs`, scope `spark-admin:calling_cdr_read`). Richiede
un'amministratore Control Hub: **non è la strada scelta**, resta solo come
alternativa documentata.

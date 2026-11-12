# Portabilità del numero italiano su Twilio

> **Strada alternativa (non obbligatoria).** Se non vuoi fare la portabilità,
> segui [`docs/numero-italiano-nuovo.md`](numero-italiano-nuovo.md): numero
> italiano nuovo da un provider VoIP, inoltrato al numero Twilio.

Obiettivo: chi chiama **067821202** deve essere risposto dal centralino virtuale,
senza deviazioni TIM né prefissi internazionali.

## Perché non basta un comando

Twilio non mette a disposizione numeri geografici italiani con voce da acquistare:
verifica effettuata sull'account (`AvailablePhoneNumbers/IT`): `Local` e `National`
non esistono, `TollFree` ha 0 numeri, `Mobile` è solo SMS.

Un numero telefonico non è una impostazione software: va acquistato presso un
operatore con licenza italiana (con verifica KYC) oppure **portato** da un operatore
esistente. Nessun codice può crearne uno.

## Buona notizia: la KYC è già fatta

Sull'account Twilio risulta già approvato il bundle regolatorio:

| Campo | Valore |
| --- | --- |
| Bundle | `BUadd65e791045117cd15b78240dca3321` |
| Nome | Italy: Local - Business |
| Stato | `twilio-approved` |
| Ragione sociale | mt italia srls |
| Indirizzo | Via Marco Tabarrini 13, 00179 Roma (RM), Lazio, IT |
| Email | tatianalori@mtitaliaretail.com |
| Customer profile | `BUb1dcaf52bf9b41d8ca97db1200fedfc6` (`twilio-approved`) |

Quindi i dati aziendali e l'indirizzo sono già stati verificati da Twilio.

## Cosa serve per la portabilità da TIM

| Documento | Chi lo fornisce |
| --- | --- |
| LOA (Lettera di Autorizzazione) in italiano, datata entro 30 giorni | modulo Twilio, firmata dal legale rappresentante |
| **Codice Segreto** | TIM (richiederlo al 187) |
| Visura / P.IVA, documento del legale rappresentante | azienda |
| Copia dell'ultima fattura telefonica TIM | TIM |

- Modulo: https://twlo.my.salesforce-sites.com/InternationalPorting
- Linee guida: https://www.twilio.com/en-us/guidelines/it/porting
- Tempi: fino a **6 settimane** dalla consegna completa dei documenti.

## Dopo la portabilità

Quando il numero `+39…` compare in Console Twilio:

```bash
npm run numero-italiano
```

Il comando imposta automaticamente `VoiceUrl`, `VoiceMethod` e status callback
su `PUBLIC_BASE_URL/twilio/voice`. Nessuna modifica al codice del centralino.

## Nel frattempo

Il centralino è raggiungibile su `+1 708 905 2752` (dall'Italia: `+1…` o `00 1…`).
In alternativa si può tentare la deviazione TIM `*21*0017089052752#` dalla linea
fissa; se TIM non abilita le deviazioni verso l'estero, la portabilità resta
l'unica soluzione stabile.

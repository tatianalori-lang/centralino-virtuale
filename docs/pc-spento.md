# Cosa succede se spengo il PC

## La risposta breve

Il server **e** il tunnel (ngrok/cloudflared) girano su questo PC. Se lo spegni:

- il webhook `https://.../telnyx/voice` non è raggiungibile
- Telnyx non riceve istruzioni → **la chiamata non viene risposta**
- **nessun ticket, nessuna email, nessun WhatsApp**

Non esiste un modo per evitarlo senza una macchina sempre accesa: i numeri di
telefono sono gestiti da Telnyx (sempre online), ma l'IVR è il nostro server.

## Vincolo deciso

Per il **24/7 anche a PC spento** è pronta la strada B: kit completo in
[`docs/sempre-online.md`](sempre-online.md) e `deploy/` (VPS + 1 record A su
Aruba).

**Non toccare i nameserver** di `mtitaliaretail.com` (restano su Aruba).
Questo esclude:

- ❌ **Cloudflare Tunnel con dominio proprio su piano Free**: il CNAME del tunnel
  deve stare nella zona DNS Cloudflare → serve il cambio nameserver.
- ❌ **Cloudflare "Partial/CNAME setup"**: non richiede il cambio NS, ma è
  disponibile solo sui piani **Business/Enterprise** (non Free/Pro).
- ❌ **Call forwarding lato Telnyx** (`npm run pc-spento -- spento`): preparato,
  ma l'account attuale risponde *"You must upgrade your account"*. Richiede un
  piano Telnyx a pagamento.

## Le tre strade possibili

### A. Avvio automatico prima del login (**già configurato** ✅)

È stata creata un'**Attività pianificata di Windows** `Centralino Virtuale` che
parte **all'avvio del sistema con l'account SYSTEM**, quindi **prima che chiunque
faccia login**. Nessuna password salvata, nessuna dipendenza dalla sessione utente.

| Elemento | Valore |
| --- | --- |
| Trigger | `MSFT_TaskBootTrigger` (all'avvio) + watchdog ogni 5 min |
| Account | `NT AUTHORITY\SYSTEM`, RunLevel `Highest` |
| Azione | `C:\ProgramData\CentralinoVirtuale\avvia.ps1` |
| ngrok | copia stabile in `C:\ProgramData\CentralinoVirtuale\ngrok.exe` + config con authtoken (ACL ristretta) |
| Log | `C:\ProgramData\CentralinoVirtuale\logs\avvio.log` |

Il launcher è **idempotente**: controlla `/api/health`, avvia solo ciò che manca,
attende il tunnel e verifica anche l'URL pubblico. Il watchdog ogni 5 minuti
ripristina eventuali processi caduti.

**Verificato** fermando tutti i processi e lanciando solo il task:

```
node  pid=24344 utente=NT AUTHORITY\SYSTEM
ngrok pid=13880 utente=NT AUTHORITY\SYSTEM
Server locale: True   URL pubblico: True
tunnel URL: https://acorn-detection-repair.ngrok-free.dev
```

```powershell
# Gestione (richiede PowerShell come Amministratore)
Get-ScheduledTask -TaskName 'Centralino Virtuale'
Start-ScheduledTask -TaskName 'Centralino Virtuale'
Get-ScheduledTaskInfo -TaskName 'Centralino Virtuale' | Select LastRunTime,LastTaskResult
Get-Content C:\ProgramData\CentralinoVirtuale\logs\avvio.log -Tail 15

# Verifica completa (come Amministratore, UAC)
.\scripts\verifica-avvio.ps1
```

File di setup: `scripts\installa-avvio.ps1` (idempotente, da rieseguire come
amministratore se serve ricreare il task).

Il vecchio collegamento in `shell:startup` è stato **rimosso** (ridondante).

⚠️ Parte all'**avvio di Windows**: il PC deve essere acceso. Se viene spento,
resta offline. Per il 24/7 anche a PC spento serve la strada B (VPS).

### B. VPS sempre acceso (soluzione definitiva, ~5-10 €/mese)

Nessun cambio nameserver: si aggiunge **un solo record A** nel DNS Aruba.

| Passo | Azione |
| --- | --- |
| 1 | Noleggia un VPS (Aruba Cloud, Hetzner, Contabo…) con IP statico |
| 2 | Nel DNS Aruba crea `A centralino.mtitaliaretail.com → IP_VPS` |
| 3 | Sul VPS: installa Node, copia il progetto, `npm install`, `npm start` |
| 4 | Davanti al server metti **Caddy** (HTTPS automatico con Let's Encrypt):<br>`centralino.mtitaliaretail.com { reverse_proxy localhost:3000 }` |
| 5 | Imposta `PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com` |
| 6 | `npm run webhook` → aggiorna app TeXML Telnyx + numero Twilio |
| 7 | Verifica con una chiamata al `+390698237118` |

Vantaggi: dominio proprio, **24/7 anche a PC spento**, posta Aruba intatta
(si aggiunge solo un record A), nessuna migrazione DNS.

### C. Mini-PC / Raspberry Pi in ufficio

Un piccolo dispositivo sempre acceso che esegue il progetto + ngrok. Costo una
tanta (~50-100 €), consumo pochi watt, nessun canone, nessuna modifica DNS.
L'URL resta il dev domain ngrok.

## Confronto

| | Costo | PC spento | Dominio proprio | Modifiche DNS |
| --- | --- | --- | --- | --- |
| A - Avvio SYSTEM pre-login (**attivo**) | 0 | ❌ | ❌ | nessuna |
| B - VPS | ~5-10 €/mese | ✅ | ✅ | 1 record A su Aruba |
| C - Mini-PC | ~50-100 € una volta | ✅ | ❌ | nessuna |
| ngrok custom domain (piano a pagamento) | ~20 $/mese | ❌ | ✅ | 1 CNAME su Aruba |

## Fallback di emergenza (richiede upgrade Telnyx)

Se in futuro l'account Telnyx viene aggiornato:

```bash
npm run pc-spento -- spento   # prima di spegnere: devia al telefono reale
npm run pc-spento -- acceso   # al riavvio: torna l'IVR
npm run pc-spento -- stato
```

La destinazione si configura con `FALLBACK_PHONE_NUMBER` in `.env`
(default `+39067821202`). Mentre è attivo l'inoltro le chiamate squillano al
telefono, ma **non** vengono creati ticket.

# URL fisso con Cloudflare Tunnel

> ⚠️ **Strada NON scelta**: richiede il cambio dei nameserver di
> `mtitaliaretail.com` (oggi su Aruba). È stato deciso di **non toccare i
> nameserver**. Vedi [`docs/pc-spento.md`](pc-spento.md) per le alternative
> (PC sempre acceso, VPS con un solo record A, mini-PC).
> Il contenuto qui sotto resta valido solo se in futuro si sceglierà la
> migrazione DNS a Cloudflare o un piano Business/Enterprise (partial setup).

Obiettivo: `https://centralino.mtitaliaretail.com` sempre raggiungibile, senza
dipendere da ngrok e senza aprire porte sul router. Il PC con il server deve
comunque restare acceso (cloudflared crea una connessione in uscita).

## Stato attuale (verificato)

| Elemento | Valore |
| --- | --- |
| `cloudflared` | ✅ installato (2026.10.7) in `C:\Program Files (x86)\cloudflared\cloudflared.exe` |
| Config tunnel | ✅ `cloudflared/config.yml` (da completare con l'UUID) |
| Script avvio | ✅ `scripts/avvia-tunnel.ps1` |
| Script webhook | ✅ `npm run webhook` |
| Nameserver attuali di `mtitaliaretail.com` | ⚠️ **Aruba** (`dns.technorail.com`, `dns3.arubadns.net`, …) |
| Dominio su Cloudflare | ❌ **non ancora** |

## Il prerequisito importante

Cloudflare Tunnel richiede che il **record CNAME** del tunnel sia nella zona DNS
dello stesso account Cloudflare (il `cfargotunnel.com` proxy funziona solo per
record dello stesso account). Quindi il dominio `mtitaliaretail.com` deve essere
**aggiunto a Cloudflare** e i nameserver devono passare da Aruba a Cloudflare.

⚠️ **Prima di cambiare i nameserver**, verifica che Cloudflare abbia importato
correttamente tutti i record, soprattutto:

- **MX** di Aruba per `assistenza@mtitaliaretail.com` (altrimenti la posta smette di arrivare)
- **A / CNAME** di `www.mtitaliaretail.com` e del sito
- eventuali record SPF/DKIM/DMARC, sottodomini, servizi attivi

Il cambio nameserver si fa nel pannello Aruba e la propagazione può richiedere
alcune ore.

## Procedura

### 1. Cloudflare (una volta, a cura tua)

1. Crea un account gratuito su https://dash.cloudflare.com/sign-up
2. **Add a site** → `mtitaliaretail.com` → piano **Free**
3. Controlla i record DNS importati (in particolare **MX** e `www`)
4. Vai su https://dash.cloudflare.com/?to=/:account/:zone/dns/records e prendi i
   **2 nameserver Cloudflare** assegnati (es. `xxx.ns.cloudflare.com`)
5. Nel pannello **Aruba** del dominio, sostituisci i nameserver con quelli Cloudflare
6. Attendi la propagazione (verifica con `nslookup -type=NS mtitaliaretail.com`)

### 2. Autenticazione cloudflared (una volta)

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel login
```

Si apre il browser: scegli il dominio `mtitaliaretail.com` e autorizza.
Viene creato `C:\Users\segre\.cloudflared\cert.pem`.

### 3. Crea il tunnel e il record DNS

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel create centralino
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel route dns centralino centralino.mtitaliaretail.com
```

Il primo comando restituisce un **UUID**: sostituiscilo al posto di
`<TUNNEL-UUID>` in `cloudflared/config.yml` (sia in `tunnel:` sia nel percorso
`credentials-file`). Il secondo crea il CNAME
`centralino → <UUID>.cfargotunnel.com`.

### 4. Passa dal URL ngrok al dominio

Modifica `.env`:

```env
PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com
```

Poi:

```bash
npm run webhook          # aggiorna app TeXML Telnyx + numero Twilio
npm start                # riavvia il server (se non è già attivo)
```

Avvia il tunnel in una finestra PowerShell che resti aperta:

```powershell
.\scripts\avvia-tunnel.ps1
```

### 5. Verifica

```bash
curl https://centralino.mtitaliaretail.com/api/health
npm run numero-telnyx -- stato
```

Poi chiama `+390698237118`: deve rispondere «Buongiorno MT Italia».

## Alternativa senza migrare il DNS

Se NON vuoi cambiare i nameserver Aruba, l'alternativa è un **VPS con IP statico**:
crei un record **A** `centralino.mtitaliaretail.com → IP del VPS` nel DNS Aruba,
ci installi Node + il progetto e un reverse proxy HTTPS (Caddy o nginx con
Let's Encrypt). Nessuna migrazione DNS, ma serve un server sempre acceso (circa
5-10 €/mese) e il dominio resta gestito da Aruba.

## Nota

Fino al completamento dei punti 1-6 lascia `PUBLIC_BASE_URL` impostato su
`https://acorn-detection-repair.ngrok-free.dev` (dev domain statico ngrok),
altrimenti i webhook Telnyx/Twilio non raggiungono il server.

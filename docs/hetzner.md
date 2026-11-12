# Hetzner CX21 per il centralino 24/7

## ✅ Stato attuale (deploy effettuato)

| Elemento | Valore |
| --- | --- |
| Server | `centralino-mt-italia` (id `175641936`) |
| Tipo | `cx23` (2 vCPU / 4 GB / 40 GB, ~€5,49/mese) |
| Location | `fsn1` (Falkenstein, DE) |
| OS | Ubuntu 24.04 LTS |
| **IPv4 statico** | **`91.99.150.162`** |
| Accesso | chiave SSH `centralino-deploy` (id `132474391`), privata in `C:\Users\segre\.ssh\centralino_deploy_ed25519` |
| URL attivo | **`https://centralino.mtitaliaretail.com`** (certificato Let's Encrypt) |
| Webhook | Telnyx `/telnyx/voice`, Twilio `/twilio/voice` → dominio aziendale |
| DNS | `A centralino.mtitaliaretail.com → 91.99.150.162` su Aruba (nessun cambio NS) |
| Servizi | `centralino.service`, `caddy.service`, `centralino-watchdog.timer`, `centralino-monitor.service` attivi e abilitati al boot |
| Firewall | `ufw`: 22, 80, 443 aperti |
| Task locale sul PC | disattivato (ridondante) |

Il dominio aziendale è **attivo e verificato** end-to-end: `/api/health` risponde
200 in HTTPS, certificato emesso da Let's Encrypt, test IVR solo voce, ticket,
telefono automatico e invio email tutti passati sul dominio definitivo.

### Monitor approvazione numero Telnyx

`centralino-monitor.service` esegue `scripts/monitora-telnyx.mjs`: ogni **10 minuti**
interroga le API Telnyx (ordine, numero, requirement group, commenti dello staff)
e invia una email a `assistenza@` e `tatianalori@` **non appena lo stato cambia**
(approvazione, rifiuto o nuovo commento Number Ops). Lo stato è persistito in
`data/telnyx-monitor-state.json`; se l'invio email fallisce non salva lo stato e
riprova al giro successivo. Comandi utili:

```bash
npm run monitora-telnyx -- --dry-run        # solo lettura, nessuna email
npm run monitora-telnyx -- --test-email    # verifica SMTP/destinatari
systemctl status centralino-monitor        # sul VPS
journalctl -u centralino-monitor -f        # log in tempo reale
```

### Dove su Aruba (percorso ufficiale)

1. Vai su **https://admin.aruba.it/** → accedi al **Pannello di controllo del dominio**
2. Seleziona **Dominio** → **`mtitaliaretail.com`**
3. Seleziona **Gestione DNS e Name Server**
4. Clicca **Aggiungi record**
5. Compila così:
   - **Tipo**: `A (Address)`
   - **Host**: `centralino`
   - **Valore**: `91.99.150.162`
   - **TTL**: lascia il valore predefinito
6. Clicca **Aggiungi**

⚠️ **Non aggiungere un dominio** (esiste già) e **non toccare i Name Server**:
si crea solo un record A per il sottodominio `centralino`. I record **MX**
della posta e quelli del sito restano intatti. Se non vedi la voce
*Gestione DNS e Name Server*, il dominio è in servizio Redirect: serve una
[modifica servizio](https://guide.aruba.it/hosting-e-domini/gestione-domini/modifica-servizio).

La propagazione richiede da pochi minuti a qualche ora. Verifica con:
```powershell
Resolve-DnsName centralino.mtitaliaretail.com -Type A
```

### Passaggio al dominio aziendale — COMPLETATO ✅

Il record A è stato aggiunto su Aruba e `passa-a-dominio.sh` è stato eseguito:
`PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com`, webhook aggiornati,
certificato emesso, `/api/health` = 200. Lo script resta riutilizzabile se in
futuro cambia l'IP del VPS.

---

**Ottima scelta**: il CX21 (oggi spesso listato come **CX23**: 2 vCPU condivise,
4 GB RAM, 40 GB NVMe, 20 TB traffico, ~€4-6/mese) è più che sufficiente.
A differenza di AWS, **l'IPv4 pubblico è statico e incluso**: niente Elastic IP.

Il kit `deploy/` è già compatibile con Ubuntu su Hetzner.

---

## Cosa serve a te (creazione del server, ~5 minuti)

1. **Account Hetzner Cloud** (email + carta/PayPal). Non posso crearlo io.
2. **Cloud → Servers → Add Server**:
   - Location: **Falkenstein** o **Nuremberg** (EU, vicino all'Italia)
   - Image: **Ubuntu 24.04 LTS** (va bene anche 22.04)
   - Type: **CX21 / CX23** (Shared, 2 vCPU / 4 GB)
   - **SSH key**: incolla la tua chiave pubblica (consigliato). In alternativa
     Hetzner invia la password root via email.
   - Opzionale: Hetzner Cloud Firewall con `80`, `443` aperti e `22` solo dal tuo IP
3. **DNS Aruba**: aggiungi **un solo record** (nessun cambio nameserver):
   ```
   A   centralino.mtitaliaretail.com   →   IP_DEL_SERVER
   ```
   La posta (MX) resta intatta.

---

## Cosa mi serve concretamente per procedere

| # | Dato | Perché |
| --- | --- | --- |
| 1 | **IPv4 pubblico** del server | per `scp`/`ssh` e per il record A |
| 2 | **Accesso SSH**: chiave privata (`.pem` / `id_ed25519`) **oppure** password root | per copiare il progetto ed eseguire l'installer |
| 3 | Conferma che il **record A** su Aruba punti all'IP | Caddy deve risolvere il nome per emettere il certificato HTTPS |
| 4 | Un **consenso UAC** a fine lavoro | per disattivare il task SYSTEM locale, ormai ridondante |

> Se usi una chiave SSH, passami il percorso del file della chiave privata (o
> incollane il contenuto). Se usi la password root, cambiala dopo avermela data.
> Su questo PC sono disponibili `ssh`, `scp` e `sftp` (non `rsync`), quindi posso
> trasferire il progetto direttamente.

---

## Cosa faccio io con quei dati

```bash
# 1. Copia del progetto (esclusi node_modules e log), .env incluso
scp -r -i CHIAVE ./ root@IP:/opt/centralino/

# 2. Installazione (Node 22 + Caddy + systemd)
ssh -i CHIAVE root@IP 'cd /opt/centralino && chmod +x deploy/install.sh && ./deploy/install.sh'

# 3. Nuovo URL pubblico
#    PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com  (in .env)

# 4. Aggiornamento webhook Telnyx + Twilio
npm run webhook
systemctl restart centralino
```

Poi verifico:

```bash
curl https://centralino.mtitaliaretail.com/api/health
systemctl status centralino
journalctl -u centralino -f
```

E infine, sul PC:

```powershell
# come Amministratore
Disable-ScheduledTask -TaskName 'Centralino Virtuale'
```

---

## Note specifiche Hetzner

- **IP statico incluso**: non serve allocare nulla, l'IPv4 assegnato alla
  creazione resta finché il server esiste.
- **Firewall**: se non configuri quello di Hetzner, posso aprire `80`/`443` con
  `ufw` da SSH. Lo SSH va limitato al tuo IP.
- **Email**: Aruba SMTP usa la porta **465**, non bloccata da Hetzner.
- **Backup**: abilita gli **snapshot automatici** Hetzner (o un backup di
  `/opt/centralino/data/`), perché i ticket sono su `data/tickets.json`.
- **Risorse**: 4 GB RAM sono abbondanti per Node + Caddy; nessun bisogno di
  database, load balancer o volumi aggiuntivi.
- **Sicurezza**: `apt update && apt upgrade`, `ufw`, `fail2ban`. Non esporre la
  dashboard senza autenticazione.

---

## Risultato atteso

- ✅ Centralino **24/7**, anche a PC spento
- ✅ `https://centralino.mtitaliaretail.com` con certificato valido
- ✅ Nessun cambio nameserver, posta Aruba intatta
- ✅ Webhook Telnyx + Twilio aggiornati con `npm run webhook`
- ✅ Avvio automatico e restart su crash via systemd

⚠️ Il numero `+390698237118` resta in review Telnyx: il deploy del server non
lo sblocca. Per quel problema il ticket con Telnyx Support è già stato aperto.

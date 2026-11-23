# Centralino VoIP con Yealink W76P (interni 101 e 102)

Guida pratica per collegare i **2 Yealink W76P** (stessa sede) al centralino VoIP su Asterisk del VPS (`91.99.150.162`) e gestire inoltro e fasce orarie dalla dashboard web.

---

## 1. Come funziona il flusso

- **Modalità predefinita (`Prima IVR, poi interni 101/102`)**:
  - Le chiamate in entrata passano sempre prima dall'IVR per raccogliere i dati e aprire il ticket.
  - Se il chiamante chiede l'**"operatore"** (o quando è attiva la modalità **Inoltro**, manuale o da fascia oraria), squillano insieme i telefoni Yealink **`101`** e **`102`** (gruppo `100`).
  - Se nessuno risponde entro `25` secondi, il chiamante sente il messaggio di ricontatto (e il ticket resta comunque salvato).
- **Modalità alternativa (`Prima interni 101/102, poi IVR`)** attivabile in qualsiasi momento dalla dashboard:
  - Squillano subito `101` e `102`; se nessuno risponde entro `25` secondi, parte l'IVR per aprire il ticket.
- **Chiamate interne e trasferimenti**:
  - Chiama **`101`** per il telefono 1, **`102`** per il telefono 2, **`100`** per far squillare entrambi.
  - Per trasferire una chiamata in corso usa il tasto **Transfer** sul cordless oppure `*2` + numero interno (`101` / `102`).
- **Chiamate in uscita**:
  - Componendo un qualsiasi numero fisso (`06...`), cellulare (`3...`) o internazionale (`00...` / `+...`), la chiamata esce dal tronco **MessageNet** mostrando `+39 06 8635 8716`.

---

## 2. Attivazione sul VPS (una sola volta)

1. Dal PC fai il deploy dell'applicazione aggiornata:
   ```powershell
   Set-Location C:\Users\info\Progetti\centralino-virtuale
   powershell -ExecutionPolicy Bypass -File scripts\deploy-vps.ps1
   ```
2. Entra sul VPS via SSH ed esegui lo script di setup VoIP:
   ```bash
   ssh -i C:\Users\info\.ssh\centralino_deploy_ed25519 root@91.99.150.162
   cd /opt/centralino
   chmod +x deploy/setup-voip-vps.sh
   ./deploy/setup-voip-vps.sh
   ```
3. Lo script genera password casuali sicure in `/opt/centralino/.env`, configura Asterisk PJSIP, attiva **Fail2ban** a protezione della porta `5060/udp` e stampa a schermo le **password degli interni `101` e `102`**.

---

## 3. Configurazione dei 2 Yealink W76P (stessa sede)

Hai due possibilità equivalenti:
- **Soluzione 1 (più ordinata)**: colleghi **1 sola base W70B** al router con il cavo Ethernet, associ **entrambi i portatili W56H** a quella base, e tieni la seconda base W70B di scorta.
- **Soluzione 2**: colleghi **entrambe le basi W70B** al router (es. in stanze lontane) e configuri l'Account 1 con `101` sulla prima base e `102` sulla seconda.

### A. Trova l'indirizzo IP della base W70B
1. Collega alimentazione e cavo di rete Ethernet tra la base **W70B** e il router dell'ufficio.
2. Sul cordless **W56H** premi **OK → Stato → Base** (oppure premi il tasto centrale sulla base per cercarlo / guarda i dispositivi connessi nel router): leggi l'indirizzo IP locale (es. `192.168.1.50`).
3. Apri dal browser del PC `http://192.168.1.50` e accedi (credenziali predefinite Yealink: utente **`admin`**, password **`admin`** — poi cambiala da *Impostazioni → Password*).

### B. Se usi 1 sola base W70B: associa il secondo portatile W56H
1. Accendi il secondo portatile W56H.
2. Tieni premuto per 3-5 secondi il pulsante fisico sulla base **W70B** finché il LED di registrazione lampeggia.
3. Sul portatile W56H premi **Reg** (o **OK → Impostazioni → Registrazione → Registra Portatile**), seleziona la base e inserisci il PIN `0000`.
4. Ora vedi `Handset 1` e `Handset 2` associati alla stessa base.

### C. Registra gli account SIP (`101` e `102`) nella base W70B
Vai su **Account → Registra**:

**Account 1 (Interno 101)**:
- **Stato Linea**: `Abilitato`
- **Etichetta**: `Postazione 101`
- **Nome visualizzato**: `Postazione 101`
- **Nome registrazione**: `101`
- **Nome utente**: `101`
- **Password**: *(la password `ASTERISK_EXT_101_PASSWORD` stampata dallo script sul VPS)*
- **Server SIP 1**: Host `91.99.150.162`, Porta `5060`, Trasporto `UDP`
- **NAT / RPort**: se presente, **RPort = Abilitato**

**Account 2 (Interno 102)** *(sulla stessa base, oppure su Account 1 della seconda base)*:
- **Stato Linea**: `Abilitato`
- **Etichetta**: `Postazione 102`
- **Nome visualizzato**: `Postazione 102`
- **Nome registrazione**: `102`
- **Nome utente**: `102`
- **Password**: *(la password `ASTERISK_EXT_102_PASSWORD` stampata dallo script sul VPS)*
- **Server SIP 1**: Host `91.99.150.162`, Porta `5060`, Trasporto `UDP`
- **NAT / RPort**: **RPort = Abilitato**

Salva: dopo pochi secondi lo stato deve diventare **`Registrato`** (`Registered`).

### D. Associa i portatili agli account (se usi 1 sola base)
Vai su **Account → Assegnazione Numero** (*Number Assignment*):
- **In entrata**:
  - `Handset 1` → spunta **Linea 1 (`101`)** *(e se vuoi puoi spuntare anche `102`)*
  - `Handset 2` → spunta **Linea 2 (`102`)**
- **In uscita**:
  - `Handset 1` → **Linea 1 (`101`)**
  - `Handset 2` → **Linea 2 (`102`)**

### E. Verifica sul VPS
```bash
asterisk -rx "pjsip show contacts"
```
Devi vedere entrambi i contatti `101/...` e `102/...` con stato `Avail`.

---

## 4. Dashboard Web di gestione (`Centralino & Orari`)

Apri **`https://centralino.mtitaliaretail.com/centralino.html`** per gestire con un click:
- **Modalità**: `Virtuale (IVR)` oppure `Inoltro diretto`
- **Ordine risposta VoIP**: scegliere tra `Prima IVR, poi interni 101/102` o `Prima interni 101/102, poi IVR`
- **Destinazione**: `100` (entrambi i Yealink), `101`, `102`, oppure un numero di cellulare/fisso esterno
- **Programmazione oraria**: fasce settimanali automatiche (pausa pranzo, sera/notte, weekend o fasce personalizzate)

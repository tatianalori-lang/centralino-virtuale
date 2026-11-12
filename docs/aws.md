# AWS per il centralino 24/7

**Sì, AWS è una scelta valida.** Per questo carico (un piccolo server Node +
Caddy) consiglio **Lightsail**: più semplice, prezzo fisso, IP statico incluso.
In alternativa va bene **EC2**.

Il kit `deploy/` è già compatibile con Ubuntu su AWS: nessuna modifica al codice.

---

## Opzione consigliata: AWS Lightsail

| Voce | Valore |
| --- | --- |
| Piano | **1 GB RAM / 1 vCPU / 40 GB SSD**, ~$5/mese (spesso 3 mesi gratis ai nuovi account) |
| OS | Ubuntu **22.04 o 24.04 LTS**, Linux/Unix, 64-bit |
| IP statico | incluso e gratuito, va allocato e agganciato |
| Firewall | aprire **80**, **443** e **22** (SSH solo dal tuo IP) |

### Passi nella console AWS

1. **Lightsail → Create instance**
   - Platform: Linux/Unix
   - Blueprint: **Ubuntu 22.04/24.04 LTS** (non "Node.js" blueprint: usiamo il nostro `install.sh`)
   - Piano: almeno **1 GB RAM**
2. **Networking → Create static IP** → assegnalo all'istanza
   ⚠️ Senza IP statico l'indirizzo cambia al riavvio e il record A su Aruba smette di funzionare.
3. **Firewall / Networking** → aggiungi regole:
   - HTTP `80` da `0.0.0.0/0`
   - HTTPS `443` da `0.0.0.0/0`
   - SSH `22` **solo dal tuo IP**
4. Scarica la **chiave SSH** (`.pem`) e annota l'IP statico.
5. Nel **DNS Aruba** aggiungi **un solo record** (nessun cambio nameserver):
   ```
   A   centralino.mtitaliaretail.com   →   IP_STATICO
   ```
6. Copia il progetto e installa (vedi [`docs/sempre-online.md`](sempre-online.md)):
   ```bash
   rsync -av --exclude node_modules --exclude data/logs ./ ubuntu@IP_STATICO:/opt/centralino/
   # oppure scp / WinSCP, incluso il file .env
   ```
   Sul VPS, come root:
   ```bash
   cd /opt/centralino
   chmod +x deploy/install.sh && ./deploy/install.sh
   ```
7. Imposta l'URL e aggiorna i webhook:
   ```env
   PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com
   ```
   ```bash
   cd /opt/centralino
   npm run webhook
   systemctl restart centralino
   ```
8. Verifica:
   ```bash
   curl https://centralino.mtitaliaretail.com/api/health
   systemctl status centralino
   journalctl -u centralino -f
   ```

---

## Alternativa: EC2

| Voce | Valore |
| --- | --- |
| Istanza | `t3.micro` (x86) o `t4g.micro` (ARM) — Ubuntu 22.04/24.04 LTS |
| Free tier | 750 h/mese per 12 mesi sui nuovi account; poi ~$8-10/mese |
| **Elastic IP** | **obbligatorio**: l'IP pubblico EC2 cambia a ogni stop/start |
| Security group | inbound `80`, `443` da `0.0.0.0/0`; `22` solo dal tuo IP |

Sulle `t4g` (arm64) il kit funziona senza modifiche: NodeSource `setup_22.x`
pubblica anche pacchetti arm64. Tutto il resto è identico a Lightsail.

---

## Note importanti

- **Email**: usiamo Aruba SMTP sulla **porta 465**, che AWS non blocca
  (AWS limita solo la porta 25 in uscita su EC2, che qui non serve). Nessun
  bisogno di SES o di richiedere lo sblocco.
- **Caddy** ha bisogno di `80`/`443` raggiungibili per emettere il certificato
  Let's Encrypt: verifica sia il firewall Lightsail/EC2 sia eventuali regole
  dell'OS prima di avviarlo.
- Non servono RDS, S3, load balancer o altri servizi: una sola istanza.
- I ticket sono su `data/tickets.json`: abilita gli **snapshot automatici**
  Lightsail (o un backup periodico di `data/`) per non perderli.
- Sicurezza: limita SSH al tuo IP, `apt update && apt upgrade`, valuta
  `fail2ban`. Non esporre la dashboard senza autenticazione.
- Una volta attivo il VPS, sul PC disattiva il task locale (ridondante):
  ```powershell
  # come Amministratore
  Disable-ScheduledTask -TaskName 'Centralino Virtuale'
  ```

---

## Cosa serve per procedere

AWS richiede un account e una carta: **non posso crearlo io**. Quando hai
l'istanza, passami **IP statico + chiave SSH (o accesso)** e faccio io copia,
installazione, configurazione dell'URL, aggiornamento dei webhook e verifica
finale della chiamata.

⚠️ Il 24/7 del server è indipendente dall'attivazione del numero
`+390698237118`, ancora in review Telnyx (ticket già aperto con Support).

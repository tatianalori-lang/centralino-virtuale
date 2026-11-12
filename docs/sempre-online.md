# Sempre online (24/7)

## La situazione

Oggi server e tunnel girano sul PC come `SYSTEM` e partono **prima del login**,
ma se il PC viene **spento** il centralino è offline. Il dev domain ngrok è
statico, ma è comunque legato a un processo locale.

Poiché è stato deciso di **non toccare i nameserver** di `mtitaliaretail.com`,
Cloudflare Tunnel con dominio proprio non è percorribile su piano Free. L'unica
soluzione 24/7 è quindi un **VPS con IP statico**: si aggiunge **un solo record A**
nel DNS Aruba (nessun cambio nameserver, posta intatta) e il servizio gira su una
macchina sempre accesa.

```
centralino.mtitaliaretail.com  →  A  →  IP_DEL_VPS  →  Caddy :443  →  Node :3000
```

## Cosa serve (a cura tua)

1. Un VPS (consigliati: **Hetzner CX21**, **Contabo VPS S**, **Aruba Cloud PRO**)
   con Ubuntu 22.04/24.04, ~5-10 €/mese
2. Porte **80 e 443** aperte
3. Un record **A** `centralino.mtitaliaretail.com → IP_VPS` nel pannello DNS Aruba
   (non si cambiano i nameserver)
4. Copia del progetto sul VPS (rsync/scp/WinSCP), **incluso `.env`**

## Cosa è già pronto in questo repository

| File | Scopo |
| --- | --- |
| `deploy/install.sh` | Installa Node, Caddy, crea l'utente di servizio e il servizio systemd |
| `deploy/Caddyfile` | HTTPS automatico (Let's Encrypt) + reverse proxy verso `:3000` |
| `deploy/centralino.service` | Avvio automatico e restart in caso di crash |

Guida specifica per **AWS** (Lightsail / EC2): [`docs/aws.md`](aws.md).
Guida specifica per **Hetzner CX21/CX23**: [`docs/hetzner.md`](hetzner.md).

## Procedura sul VPS

```bash
# 1. Copia il progetto (da eseguire sul PC, esempio con rsync)
rsync -av --exclude node_modules --exclude data/logs \
  ./  root@IP_VPS:/opt/centralino/

# 2. Sul VPS, come root
cd /opt/centralino
chmod +x deploy/install.sh
./deploy/install.sh
```

L'installer:
- installa Node.js 22 e Caddy
- crea l'utente `centralino`
- installa le dipendenze con `npm ci --omit=dev`
- copia `Caddyfile` e l'unità systemd
- abilita `centralino.service` (riparte da solo dopo un riavvio o un crash)

## Configurazione finale

Sul VPS modifica `.env`:

```env
PUBLIC_BASE_URL=https://centralino.mtitaliaretail.com
```

Poi aggiorna i webhook di Telnyx e Twilio (usa le stesse chiavi API):

```bash
cd /opt/centralino
npm run webhook
systemctl restart centralino
```

Verifica:

```bash
curl https://centralino.mtitaliaretail.com/api/health
systemctl status centralino
journalctl -u centralino -f
```

Infine sul PC disattiva l'attività pianificata locale (ridondante):

```powershell
# come Amministratore
Disable-ScheduledTask -TaskName 'Centralino Virtuale'
```

## Risultato

- ✅ Centralino **24/7**, anche a PC spento — attivo su **`https://centralino.mtitaliaretail.com`**
- ✅ Dominio proprio con certificato Let's Encrypt (record A su Aruba, nessun cambio nameserver)
- ✅ HTTPS con certificato valido
- ✅ Nessun cambio nameserver, posta Aruba intatta
- ✅ `npm run webhook` aggiorna insieme app TeXML Telnyx e numero Twilio
- ✅ Dashboard raggiungibile su `https://centralino.mtitaliaretail.com`

⚠️ Il numero `+390698237118` resta comunque in review Telnyx: il 24/7 del server
non sblocca l'attivazione del numero. Per quello è stato aperto un ticket a
Telnyx Support (vedi `scripts/apri-ticket-telnyx.mjs`).

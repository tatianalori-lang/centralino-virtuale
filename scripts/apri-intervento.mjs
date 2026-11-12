import { config } from '../lib/config.js';

// Apre un intervento tecnico per un ticket del centralino.
// Uso: npm run apri-intervento -- TK-20261111-0001 [idClienteOSM] [--dry-run]

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dryRun = process.argv.includes('--dry-run');
const [id, idAnagrafica] = args;
const base = process.env.BASE || config.publicBaseUrl || 'http://localhost:3000';

if (!id) {
  console.error('Uso: npm run apri-intervento -- <idTicket> [idClienteOSM] [--dry-run]');
  process.exit(1);
}

const res = await fetch(`${base}/api/tickets/${encodeURIComponent(id)}/intervento`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idAnagrafica, dryRun })
});
const data = await res.json().catch(() => ({}));

console.log(`HTTP ${res.status}`);
if (data.needCliente) {
  console.log('Serve scegliere il cliente OSM. Candidati:');
  for (const c of data.clienti || []) console.log(`  ${c.id}  ${c.nome}`);
  console.log('\nRilancia con: npm run apri-intervento -- ' + id + ' <idCliente>');
} else if (data.dryRun) {
  console.log('DRY-RUN (nessun intervento creato). Payload:');
  console.log(JSON.stringify(data.payload, null, 2));
} else if (data.ok) {
  console.log('Intervento aperto:', JSON.stringify(data.intervento));
  console.log('Collegamento salvato sul ticket', id);
} else {
  console.error('Errore:', data.error || JSON.stringify(data));
  process.exit(1);
}

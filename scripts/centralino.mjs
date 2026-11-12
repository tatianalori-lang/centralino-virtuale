#!/usr/bin/env node

const base = (
  process.env.CENTRALINO_URL || `http://localhost:${process.env.PORT || 3000}`
).replace(/\/+$/, '');

function usage() {
  console.log(`
Centralino Virtuale - comando modalita

Uso:
  npm run centralino -- status
  npm run centralino -- virtuale
  npm run centralino -- inoltro
  npm run centralino -- numero +393331234567

Modalita:
  virtuale   Le chiamate sono gestite dall'IVR del centralino virtuale.
  inoltro    Le chiamate vengono inoltrate direttamente al numero configurato
             (FORWARD_NUMBER), senza passare dall'IVR.

Variabili:
  CENTRALINO_URL   URL del server (default http://localhost:3000)
`);
}

async function api(path, options) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(data?.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

const [, , command = 'status', value] = process.argv;

try {
  if (command === 'status') {
    const state = await api('/api/modalita');
    console.log(`Modalita:          ${state.mode}`);
    console.log(`Numero centralino: ${state.centralinoNumber || '-'}`);
    console.log(`Numero inoltro:    ${state.number || 'non configurato'}`);
  } else if (command === 'virtuale') {
    await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'virtuale' })
    });
    console.log('Modalita impostata: virtuale (IVR attivo).');
  } else if (command === 'inoltro') {
    const state = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'inoltro', number: value })
    });
    console.log(`Modalita impostata: inoltro diretto verso ${state.number}.`);
  } else if (command === 'numero') {
    if (!value) {
      throw new Error(
        'Indica il numero: npm run centralino -- numero +393331234567'
      );
    }
    const state = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: value })
    });
    console.log(`Numero di inoltro salvato: ${state.number}`);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Errore: ${error.message}`);
  console.error('Assicurati che il server sia avviato (npm start).');
  process.exitCode = 1;
}

#!/usr/bin/env node

/**
 * Gestione del numero italiano su Telnyx (senza Twilio).
 *
 * Uso:
 *   npm run numero-telnyx -- cerca      # verifica chiave, saldo, numeri disponibili (solo lettura)
 *   npm run numero-telnyx -- app        # crea/aggiorna l'app TeXML che punta al centralino
 *   npm run numero-telnyx -- stato      # numeri già acquistati e app TeXML
 *   npm run numero-telnyx -- requisiti  # crea/lista il Requirement Group Italy
 *   npm run numero-telnyx -- compra +390698237118   # acquista (esplicito!)
 *   npm run numero-telnyx -- assegna +390698237118  # assegna il numero all'app TeXML
 *
 * L'acquisto avviene SOLO con il comando `compra` esplicito.
 * Nota: l'Italia NON supporta la pre-approvazione del Requirement Group:
 * basta che sia "fulfilled" (17/17 valori) per poter ordinare il numero.
 */

import { config } from '../lib/config.js';

const apiKey = config.telnyx.apiKey;
const base = config.publicBaseUrl;
const command = process.argv[2] || 'cerca';

if (!apiKey) {
  console.error('Errore: TELNYX_API_KEY mancante in .env');
  console.error('Genera una API key v2 nel Mission Control Portal > API Keys.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: 'application/json',
  'Content-Type': 'application/json'
};

async function telnyx(path, options = {}) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.errors?.map((e) => e.detail || e.title).join('; ') || data?.message || text;
    throw new Error(`${res.status}: ${msg}`);
  }
  return data;
}

if (command === 'cerca') {
  const balance = await telnyx('/balance');
  console.log(
    'Saldo:',
    balance.data?.balance ?? balance.balance ?? 'n/d',
    balance.data?.currency ?? ''
  );

  const q = new URLSearchParams({
    'filter[country_code]': 'IT',
    'filter[phone_number_type]': 'local',
    'filter[locality]': 'Rome',
    'filter[features]': 'voice',
    'filter[limit]': '10'
  });
  const available = await telnyx(`/available_phone_numbers?${q}`);
  const numbers = available.data || available.results || [];
  console.log(`Numeri italiani (Roma 06) disponibili: ${numbers.length}`);
  for (const n of numbers) {
    const cost = n.cost_information?.monthly_cost;
    console.log(
      ' ',
      n.phone_number,
      n.phone_number_type ?? '',
      (n.region_information || []).map((r) => r.region_name).join('/'),
      cost ? `${cost} ${n.cost_information?.currency || 'USD'}/mese` : ''
    );
  }

  const groups = await telnyx('/requirement_groups?page[size]=20');
  const grp = groups.data || [];
  console.log(`Requirement Group presenti: ${grp.length}`);
  for (const g of grp) {
    console.log(' ', g.id, g.status, g.country_code, g.phone_number_type, g.action);
  }
  console.log('');
  console.log('Per acquistare serve un Requirement Group Italy con tutti i 17 requisiti compilati.');
  console.log('Vedi docs/numero-telnyx.md.');
} else if (command === 'app') {
  if (!base) {
    console.error('Errore: PUBLIC_BASE_URL mancante in .env');
    process.exit(1);
  }
  const voiceUrl = `${base}/telnyx/voice`;
  const list = await telnyx('/texml_applications');
  const existing = (list.data || []).find((a) => a.friendly_name === 'Centralino Virtuale MT Italia');

  const body = JSON.stringify({
    friendly_name: 'Centralino Virtuale MT Italia',
    voice_url: voiceUrl,
    voice_fallback_url: voiceUrl,
    voice_method: 'POST',
    voice_fallback_method: 'POST'
  });

  let app;
  if (existing) {
    app = await telnyx(`/texml_applications/${existing.id}`, { method: 'PATCH', body });
    console.log('App TeXML aggiornata:', app.data?.id ?? existing.id);
  } else {
    app = await telnyx('/texml_applications', { method: 'POST', body });
    console.log('App TeXML creata:', app.data?.id);
  }
  console.log('Webhook voce:', voiceUrl);
  console.log('Assegna il numero italiano a questa app nel portale Telnyx.');
} else if (command === 'stato') {
  const [numbers, apps, groups, orders] = await Promise.all([
    telnyx('/phone_numbers?page[size]=50'),
    telnyx('/texml_applications'),
    telnyx('/requirement_groups?page[size]=20'),
    telnyx('/number_orders?page[size]=10')
  ]);
  console.log('Numeri:', (numbers.data || []).map((n) => `${n.phone_number} [${n.status}]`).join(', ') || 'nessuno');
  console.log('App TeXML:', (apps.data || []).map((a) => `${a.friendly_name} (${a.id})`).join(', ') || 'nessuna');
  console.log(
    'Requirement Group:',
    (groups.data || [])
      .map((g) => `${g.id} [${g.status}] ${g.country_code}/${g.phone_number_type}/${g.action}`)
      .join(', ') || 'nessuno'
  );
  console.log(
    'Ordini:',
    (orders.data || [])
      .map((o) => `${o.id} [${o.status}] requisiti=${o.requirements_met}`)
      .join(', ') || 'nessuno'
  );
  const pending = (numbers.data || []).filter((n) => n.status !== 'active');
  if (pending.length) {
    console.log('');
    console.log('In attesa di review Telnyx:', pending.map((n) => `${n.phone_number} (${n.status})`).join(', '));
    console.log('Tempi indicativi: da poche ore a 1-2 giorni lavorativi.');
  }
} else if (command === 'requisiti') {
  const list = await telnyx('/requirement_groups?page[size]=20');
  let group = (list.data || []).find(
    (g) => g.country_code === 'IT' && g.phone_number_type === 'local' && g.action === 'ordering'
  );

  if (!group) {
    const created = await telnyx('/requirement_groups', {
      method: 'POST',
      body: JSON.stringify({
        country_code: 'IT',
        phone_number_type: 'local',
        action: 'ordering',
        customer_reference: 'MT Italia - numero italiano centralino'
      })
    });
    group = created.data;
    console.log('Requirement Group creato:', group.id);
  } else {
    console.log('Requirement Group esistente:', group.id, `(${group.status})`);
  }

  const detail = await telnyx(`/requirement_groups/${group.id}`);
  const reqs = detail.data?.regulatory_requirements || [];
  console.log(`Requisiti da soddisfare: ${reqs.length} (compilati: ${reqs.filter((r) => r.field_value).length})`);
  for (const r of reqs) {
    console.log(' ', r.field_type, r.requirement_id, r.status, r.field_value ? 'OK' : '—');
  }
  console.log('');
  console.log('Nota: per l\'Italia la pre-approvazione non è supportata.');
  console.log('Un gruppo con tutti i valori è sufficiente per ordinare il numero.');
} else if (command === 'compra') {
  const numero = process.argv[3];
  if (!numero || !/^\+39\d{8,12}$/.test(numero)) {
    console.error('Indica il numero in formato E.164: compra +390698237118');
    process.exit(1);
  }
  const groupId = config.telnyx.requirementGroupId;
  if (!groupId) {
    console.error('Errore: TELNYX_REQUIREMENT_GROUP_ID mancante in .env');
    process.exit(1);
  }

  const detail = await telnyx(`/requirement_groups/${groupId}`);
  const reqs = detail.data?.regulatory_requirements || [];
  const missing = reqs.filter((r) => !r.field_value);
  if (missing.length) {
    console.error(`Requirement Group incompleto: mancano ${missing.length} requisiti.`);
    process.exit(1);
  }

  const balance = await telnyx('/balance');
  const credit = Number(balance.data?.balance ?? balance.balance ?? 0);
  if (credit < 4) {
    console.error(`Credito insufficiente: ${credit} USD (servono ~4 USD).`);
    process.exit(1);
  }

  const order = await telnyx('/number_orders', {
    method: 'POST',
    body: JSON.stringify({
      phone_numbers: [{ phone_number: numero, requirement_group_id: groupId }],
      customer_reference: 'MT Italia - centralino virtuale'
    })
  });
  const data = order.data || order;
  console.log('Ordine creato:', data.id);
  console.log('Stato:', data.status);
  console.log('Requisiti soddisfatti:', data.requirements_met);
  for (const n of data.phone_numbers || []) {
    console.log(' Numero:', n.phone_number, '| stato:', n.status, '| requisiti:', n.requirements_status);
  }
  console.log('');
  console.log('Poi assegna il numero all\'app TeXML con:');
  console.log(`  npm run numero-telnyx -- assegna ${numero}`);
} else if (command === 'assegna') {
  const numero = process.argv[3];
  const appId = config.telnyx.texmlAppId;
  if (!numero || !appId) {
    console.error('Uso: assegna +390698237118 (serve TELNYX_TEXML_APP_ID in .env)');
    process.exit(1);
  }
  const list = await telnyx('/phone_numbers?page[size]=50');
  const found = (list.data || []).find((n) => n.phone_number === numero);
  if (!found) {
    console.error(`Numero ${numero} non presente sull'account (l'ordine potrebbe essere ancora in revisione).`);
    process.exit(1);
  }
  const updated = await telnyx(`/phone_numbers/${found.id}`, {
    method: 'PATCH',
    // L'ID dell'app TeXML si usa come connection_id.
    body: JSON.stringify({ connection_id: appId })
  });
  const d = updated.data || updated;
  console.log('Numero assegnato all\'app TeXML:', d.phone_number || numero);
  console.log('Connection/App ID:', d.connection_id || appId);
} else {
  console.error(`Comando sconosciuto: ${command}`);
  console.error('Usa: cerca | app | stato | requisiti | compra | assegna');
  process.exit(1);
}

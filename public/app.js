const state = {
  meta: null,
  tickets: [],
  stats: {},
  filters: { q: '', status: '', reason: '', product: '' },
  selectedId: null,
  autoRefresh: true,
  timer: null,
  twilio: { phoneNumber: '', publicBaseUrl: '' },
  forward: { mode: 'virtuale', enabled: false, number: '', centralinoNumber: '' },
  schedule: { enabled: false, slots: [], defaultMode: 'virtuale', timezone: 'Europe/Rome' }
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Errore ${response.status}`;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {
      /* risposta non JSON */
    }
    throw new Error(message);
  }
  return response.json();
}

let toastTimer;
function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = 'toast hidden';
  }, 3200);
}

function statusLabel(value) {
  return state.meta?.statuses?.find((s) => s.value === value)?.label || value || '—';
}

function priorityLabel(value) {
  return { bassa: 'Bassa', media: 'Media', alta: 'Alta' }[value] || value || '—';
}

function optionsHtml(options, selected, placeholder) {
  const head = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '';
  return (
    head +
    options
      .map((option) => {
        const value = option.value ?? option.key;
        const label = option.label ?? option.value ?? option.key;
        return `<option value="${escapeHtml(value)}"${
          value === selected ? ' selected' : ''
        }>${escapeHtml(label)}</option>`;
      })
      .join('')
  );
}

async function loadMeta() {
  state.meta = await api('/api/meta');

  $('#statusFilter').innerHTML = optionsHtml(
    state.meta.statuses,
    '',
    'Tutti gli stati'
  );
  $('#reasonFilter').innerHTML = optionsHtml(
    state.meta.reasons,
    '',
    'Tutti i motivi'
  );
  $('#productFilter').innerHTML = optionsHtml(
    state.meta.products,
    '',
    'Tutti i prodotti'
  );

  document.title = `${state.meta.companyName} · Centralino Virtuale`;
}

async function loadTwilioStatus() {
  try {
    const status = await api('/api/twilio/status');
    state.twilio = status;
    renderTimHint();
    const element = $('#twilioStatus');
    if (status.ready) {
      element.className = 'status-pill ok';
      element.textContent = 'Twilio configurato';
      element.title = `Numero: ${status.phoneNumber || '—'} · Webhook: ${
        status.publicBaseUrl || '—'
      }`;
    } else {
      element.className = 'status-pill warn';
      element.textContent = 'Twilio da configurare';
      const missing = [];
      if (!status.accountSid) missing.push('Account SID');
      if (!status.authToken) missing.push('Auth Token');
      if (!status.phoneNumber) missing.push('numero Twilio');
      if (!status.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
      element.title = `Mancano: ${missing.join(', ')}`;
    }
  } catch {
    const element = $('#twilioStatus');
    element.className = 'status-pill warn';
    element.textContent = 'Stato Twilio non disponibile';
  }
}

function timForwardCode(phoneNumber) {
  const clean = String(phoneNumber || '').trim();
  if (!clean) return '';
  const withPlus = clean.startsWith('+') ? clean : `+${clean}`;
  const digits = withPlus.replace(/^\+/, '');
  return {
    plus: `*21*${withPlus}#`,
    zeroZero: `*21*00${digits}#`,
    bare: `*21*${digits}#`
  };
}

function renderTimHint() {
  const codes = timForwardCode(state.twilio.phoneNumber);
  const italian = state.twilio?.italianNumber || '067821202';
  const element = $('#timCode');
  const alt = $('#timCodeAlt');
  const button = $('#copyTimCode');

  $('#timHintTitle').textContent = `Inoltro di ${italian} (TIM) verso il centralino virtuale`;

  if (!codes.plus) {
    element.textContent = 'numero Twilio non configurato';
    alt.textContent = '';
    button.disabled = true;
    return;
  }

  element.textContent = codes.zeroZero;
  alt.textContent =
    `Digita il codice dalla linea ${italian}, non dal cellulare. ` +
    `Altre forme da provare: ${codes.plus} oppure ${codes.bare}. ` +
    `Verifica con *#21#, disattiva con #21#. ` +
    `Se il servizio risulta disattivato, chiama il 187 per attivarlo.`;
  button.disabled = false;
  element.dataset.code = codes.zeroZero;
}

async function copyTimCode() {
  const code = $('#timCode').dataset.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast(`Codice copiato: ${code}`);
    return;
  } catch {
    // Fallback per browser che negano l'accesso agli appunti.
  }

  const area = document.createElement('textarea');
  area.value = code;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  toast(
    copied
      ? `Codice copiato: ${code}`
      : 'Copia non riuscita: seleziona il codice e copialo a mano',
    !copied
  );
}

async function loadForward() {
  try {
    state.forward = await api('/api/modalita');
    renderForward();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderForward() {
  const forward = state.forward || {};
  const isForward = forward.mode === 'inoltro' || forward.enabled;
  const strategy = forward.voipStrategy === 'voip_first' ? 'voip_first' : 'ivr_first';

  $('#forwardPanel').classList.toggle('active', isForward);
  $('#modeVirtuale').classList.toggle('active', !isForward);
  $('#modeInoltro').classList.toggle('active', isForward);
  $('#modeVirtuale').setAttribute('aria-pressed', String(!isForward));
  $('#modeInoltro').setAttribute('aria-pressed', String(isForward));
  $('#voipStrategy').classList.toggle('hidden', isForward);
  $('#voipStrategy').value = strategy;
  $('#forwardNumber').value = forward.number || '';

  const strategyDesc =
    strategy === 'voip_first'
      ? 'Squillano prima gli interni 101–106; se non risponde nessuno parte il Centralino Virtuale.'
      : 'Risponde prima il Centralino Virtuale; gli interni 101–106 squillano su richiesta "operatore".';

  $('#forwardDesc').textContent = isForward
    ? `Inoltro diretto attivo verso ${
        forward.number || 'interni VoIP 101–106'
      }. Le chiamate non passano dal Centralino Virtuale.`
    : `Centralino Virtuale attivo. ${strategyDesc} Centralino: ${
        forward.centralinoNumber || '—'
      }.`;
}

async function setVoipStrategy(voipStrategy) {
  try {
    const forward = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voipStrategy })
    });
    state.forward = forward;
    renderForward();
    toast(
      voipStrategy === 'voip_first'
        ? 'Ordine: prima interni 101–106, poi inoltro a Centralino Virtuale'
        : 'Ordine: prima inoltro a Centralino Virtuale, poi interni 101–106'
    );
  } catch (error) {
    toast(error.message, true);
  }
}

async function setMode(mode) {
  try {
    const payload = {
      mode,
      number: $('#forwardNumber').value.trim()
    };
    if (mode === 'virtuale') payload.voipStrategy = 'ivr_first';

    const forward = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    state.forward = forward;
    renderForward();
    toast(
      mode === 'inoltro'
        ? `Inoltro diretto attivo verso ${forward.number}`
        : 'Centralino Virtuale attivo'
    );
  } catch (error) {
    toast(error.message, true);
  }
}

async function saveForwardNumber() {
  try {
    const forward = await api('/api/modalita', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: $('#forwardNumber').value.trim() })
    });
    state.forward = forward;
    renderForward();
    toast('Numero di inoltro salvato');
  } catch (error) {
    toast(error.message, true);
  }
}

const DAY_NAMES = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mer',
  4: 'Gio',
  5: 'Ven',
  6: 'Sab'
};

async function loadSchedule() {
  try {
    state.schedule = await api('/api/schedule');
    renderSchedule();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderSchedule() {
  const s = state.schedule || {};
  $('#scheduleEnabled').checked = Boolean(s.enabled);
  $('#scheduleDefaultMode').value = s.defaultMode || 'virtuale';
  $('#scheduleDesc').textContent = s.enabled
    ? `Programmazione attiva · fuori fascia: ${
        s.defaultMode === 'inoltro' ? 'Inoltro diretto' : 'Centralino Virtuale'
      }`
    : 'Programmazione disattivata · usa il pulsante per attivarla';

  const container = $('#scheduleSlots');
  const slots = s.slots || [];
  if (!slots.length) {
    container.innerHTML = '<p class="muted" style="font-size:13px;margin:0">Nessuna fascia configurata.</p>';
    return;
  }

  container.innerHTML = slots
    .map((slot, index) => {
      const days = (slot.days || [])
        .map((d) => DAY_NAMES[d] || d)
        .join(', ');
      const time = `${slot.start || ''} → ${slot.end || ''}${slot.nextDay ? ' (giorno dopo)' : ''}${slot.endDayOffset ? ` (+${slot.endDayOffset} gg)` : ''}`;
      const mode = slot.mode || 'inoltro';
      return `<div class="schedule-slot">
        <span class="slot-days">${escapeHtml(days)}</span>
        <span class="slot-time">${escapeHtml(time)}</span>
        <span class="slot-mode ${escapeHtml(mode)}">${escapeHtml(
          mode === 'inoltro' ? 'Inoltro diretto' : 'Centralino Virtuale'
        )}</span>
        <button class="slot-remove" type="button" data-remove-slot="${index}" aria-label="Rimuovi fascia">×</button>
      </div>`;
    })
    .join('');
}

async function saveSchedule() {
  try {
    const schedule = await api('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: $('#scheduleEnabled').checked,
        defaultMode: $('#scheduleDefaultMode').value,
        slots: state.schedule.slots || []
      })
    });
    state.schedule = schedule;
    renderSchedule();
    toast('Programma orario salvato');
  } catch (error) {
    toast(error.message, true);
  }
}

function addSlot() {
  const daysSelect = $('#slotDays');
  const selectedDays = Array.from(daysSelect.selectedOptions).map((o) => Number(o.value));
  if (!selectedDays.length) {
    toast('Seleziona almeno un giorno', true);
    return;
  }
  const slot = {
    days: selectedDays,
    start: $('#slotStart').value || '00:00',
    end: $('#slotEnd').value || '00:00',
    mode: $('#slotMode').value || 'inoltro',
    nextDay: $('#slotNextDay').checked
  };
  if (!$('#slotNextDay').checked && $('#slotEnd').value <= $('#slotStart').value) {
    // Se end <= start e non nextDay, assumiamo giorno successivo
    slot.nextDay = true;
  }
  state.schedule.slots = state.schedule.slots || [];
  state.schedule.slots.push(slot);
  renderSchedule();
  toast('Fascia aggiunta (ricorda di salvare)');
}

function removeSlot(index) {
  if (!state.schedule.slots) return;
  state.schedule.slots.splice(index, 1);
  renderSchedule();
  toast('Fascia rimossa (ricorda di salvare)');
}

function filterQuery() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.status) params.set('status', state.filters.status);
  if (state.filters.reason) params.set('reason', state.filters.reason);
  if (state.filters.product) params.set('product', state.filters.product);
  return params;
}

async function refresh() {
  try {
    const params = filterQuery();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const [list, stats] = await Promise.all([
      api(`/api/tickets${suffix}`),
      api('/api/stats')
    ]);
    state.tickets = list.tickets;
    state.stats = stats;
    renderStats();
    renderTickets();
    $('#lastUpdate').textContent = `Aggiornato alle ${new Date().toLocaleTimeString(
      'it-IT'
    )} · ${list.count} ticket`;
  } catch (error) {
    toast(error.message, true);
  }
}

function renderStats() {
  const stats = state.stats;
  const cards = [
    ['Ticket totali', stats.total || 0, ''],
    ['Nuovi', stats.nuovo || 0, 'accent'],
    ['In lavorazione', stats.in_lavorazione || 0, 'warn'],
    ['Chiusi', stats.chiuso || 0, 'good'],
    ['Alta priorità', stats.alta || 0, 'danger']
  ];

  $('#stats').innerHTML = cards
    .map(
      ([label, value, className]) =>
        `<div class="stat ${className}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`
    )
    .join('');
}

function rowHtml(ticket) {
  const statusOptions = optionsHtml(
    state.meta.statuses,
    ticket.status
  );
  const caller = ticket.caller || {};

  return `<tr data-id="${escapeHtml(ticket.id)}">
    <td>
      <div class="ticket-id">${escapeHtml(ticket.id)}</div>
      <div class="cell-sub">${escapeHtml(formatDate(ticket.createdAt))}</div>
    </td>
    <td>
      <div class="cell-main">${escapeHtml(caller.name || '—')}</div>
      <div class="cell-sub">${escapeHtml(caller.phone || '')}</div>
    </td>
    <td>
      <div class="cell-main">${escapeHtml(ticket.reason || '—')}</div>
      <div class="cell-sub">${escapeHtml(ticket.product || '')}</div>
    </td>
    <td>
      <div class="issue-cell" title="${escapeHtml(ticket.issue || '')}">${escapeHtml(
        ticket.issue || '—'
      )}</div>
    </td>
    <td><span class="badge ${escapeHtml(ticket.priority)}">${escapeHtml(
      priorityLabel(ticket.priority)
    )}</span></td>
    <td>
      <select class="status-select" data-status-id="${escapeHtml(ticket.id)}" aria-label="Stato ticket">
        ${statusOptions}
      </select>
    </td>
  </tr>`;
}

function renderTickets() {
  const body = $('#ticketsBody');
  const empty = $('#emptyState');

  if (!state.tickets.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  body.innerHTML = state.tickets.map(rowHtml).join('');
}

async function patchTicket(id, patch) {
  try {
    await api(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    toast('Ticket aggiornato');
    await refresh();
    if (state.selectedId === id) await openTicket(id);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderDrawer(ticket) {
  const caller = ticket.caller || {};
  const notes = (ticket.notes || [])
    .map(
      (note) => `<div class="note">${escapeHtml(note.text)}
        <div class="meta">${escapeHtml(note.author || 'Operatore')} · ${escapeHtml(
          formatDate(note.at)
        )}</div>
      </div>`
    )
    .join('');
  const history = (ticket.history || [])
    .slice()
    .reverse()
    .map(
      (entry) => `<div class="note">${escapeHtml(entry.event)}
        <div class="meta">${escapeHtml(formatDate(entry.at))}</div>
      </div>`
    )
    .join('');

  const drawer = $('#drawer');
  drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>${escapeHtml(ticket.id)}</h2>
        <p>${escapeHtml(formatDate(ticket.createdAt))} · Canale: ${escapeHtml(
          ticket.source || '—'
        )}</p>
      </div>
      <button class="icon-btn" type="button" data-close-drawer aria-label="Chiudi">×</button>
    </div>

    <div class="drawer-body">
      <div class="detail-grid">
        <div class="detail"><div class="label">Chiamante</div><div class="value">${escapeHtml(
          caller.name || '—'
        )}</div></div>
        <div class="detail"><div class="label">Telefono</div><div class="value">${escapeHtml(
          caller.phone || '—'
        )}${
          caller.phone
            ? ` <button class="btn btn-ghost" id="saveContactBtn" type="button" style="margin-left:8px;padding:3px 8px;font-size:11.5px">+ Rubrica</button> <button class="btn btn-ghost" id="blockCallerBtn" type="button" style="margin-left:4px;padding:3px 8px;font-size:11.5px;color:var(--red);border-color:#fecaca">Blocca numero</button>`
            : ''
        }</div></div>
        ${
          caller.email
            ? `<div class="detail"><div class="label">Email</div><div class="value">${escapeHtml(
                caller.email
              )}</div></div>`
            : ''
        }
        <div class="detail"><div class="label">Azienda</div><div class="value">${escapeHtml(
          caller.company || '—'
        )}</div></div>
        <div class="detail"><div class="label">Indirizzo</div><div class="value">${escapeHtml(
          caller.address || '—'
        )}</div></div>
        <div class="detail"><div class="label">Motivo</div><div class="value">${escapeHtml(
          ticket.reason || '—'
        )}</div></div>
        <div class="detail"><div class="label">Prodotto</div><div class="value">${escapeHtml(
          ticket.product || '—'
        )}</div></div>
        <div class="detail"><div class="label">Priorità</div><div class="value"><span class="badge ${escapeHtml(
          ticket.priority
        )}">${escapeHtml(priorityLabel(ticket.priority))}</span></div></div>
      </div>

      <div class="section-title">Problematica</div>
      <div class="issue-box">${escapeHtml(ticket.issue || 'Nessuna descrizione fornita.')}</div>

      <div class="section-title">Gestione ticket</div>
      <div class="form-row">
        <div class="field">
          <label for="drawerStatus">Stato</label>
          <select id="drawerStatus">
            ${optionsHtml(state.meta.statuses, ticket.status)}
          </select>
        </div>
        <div class="field">
          <label for="drawerPriority">Priorità</label>
          <select id="drawerPriority">
            ${optionsHtml(
              state.meta.priorities.map((p) => ({ value: p, label: priorityLabel(p) })),
              ticket.priority
            )}
          </select>
        </div>
      </div>
      <div class="field" style="margin-bottom: 10px">
        <label for="drawerAssignee">Operatore assegnato</label>
        <input id="drawerAssignee" value="${escapeHtml(
          ticket.assignee || ''
        )}" placeholder="Nome operatore" />
      </div>

      <div class="section-title">Intervento tecnico</div>
      <div class="detail" style="margin-bottom: 10px">
        <div class="label">Collegamento</div>
        <div class="value" id="interventoValue">${
          ticket.intervento?.id
            ? `Intervento <strong>${escapeHtml(
                ticket.intervento.codice || String(ticket.intervento.id)
              )}</strong> — <a href="${escapeHtml(
                ticket.intervento.url || '#'
              )}" target="_blank" rel="noopener">apri Gestione Interventi</a>`
            : 'Nessun intervento collegato'
        }</div>
      </div>
      <div class="field" id="interventoClienteRow" style="display:none;margin-bottom:10px">
        <label for="interventoCliente">Cliente OSM</label>
        <select id="interventoCliente"></select>
      </div>
      <button class="btn" id="apriIntervento" type="button" style="margin-bottom:10px" ${
        ticket.intervento?.id ? 'disabled' : ''
      }>Apri intervento</button>

      <div class="section-title">Note interne</div>
      <div class="notes">${
        notes || '<p class="muted" style="font-size:13px;margin:0">Nessuna nota.</p>'
      }</div>
      <textarea id="drawerNote" placeholder="Aggiungi una nota interna…"></textarea>

      <div class="section-title">Cronologia</div>
      <div class="notes">${history || '<p class="muted" style="font-size:13px;margin:0">Nessun evento.</p>'}</div>
    </div>

    <div class="drawer-foot">
      <button class="btn btn-danger" id="deleteTicket" type="button">Elimina</button>
      <button class="btn btn-primary" id="saveTicket" type="button">Salva modifiche</button>
    </div>
  `;

  $('#saveTicket').addEventListener('click', () => {
    const patch = {
      status: $('#drawerStatus').value,
      priority: $('#drawerPriority').value,
      assignee: $('#drawerAssignee').value.trim()
    };
    const note = $('#drawerNote').value.trim();
    if (note) patch.note = note;
    patchTicket(ticket.id, patch);
  });

  const apriBtn = $('#apriIntervento');
  if (apriBtn && !ticket.intervento?.id) {
    apriBtn.addEventListener('click', async () => {
      const select = $('#interventoCliente');
      const idAnagrafica = select && select.value ? select.value : undefined;
      const valueBox = $('#interventoValue');
      apriBtn.disabled = true;
      apriBtn.textContent = 'Apertura…';
      try {
        const res = await fetch(
          `/api/tickets/${encodeURIComponent(ticket.id)}/intervento`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idAnagrafica })
          }
        );
        const data = await res.json();

        if (res.status === 422 && data.needCliente) {
          const options = (data.clienti || [])
            .map(
              (c) =>
                `<option value="${escapeHtml(String(c.id))}">${escapeHtml(c.nome)}</option>`
            )
            .join('');
          $('#interventoCliente').innerHTML =
            options || '<option value="">Nessun cliente trovato</option>';
          $('#interventoClienteRow').style.display = '';
          valueBox.textContent = 'Seleziona il cliente OSM a cui intestare l\'intervento.';
          apriBtn.disabled = false;
          apriBtn.textContent = 'Conferma cliente e apri';
          return;
        }
        if (!res.ok) {
          valueBox.textContent = data.error || 'Apertura non riuscita.';
          apriBtn.disabled = false;
          apriBtn.textContent = 'Apri intervento';
          return;
        }

        valueBox.innerHTML = `Intervento <strong>${escapeHtml(
          data.intervento.codice || String(data.intervento.id)
        )}</strong> aperto — <a href="${escapeHtml(
          data.intervento.url
        )}" target="_blank" rel="noopener">apri Gestione Interventi</a>`;
        apriBtn.remove();
        toast('Intervento tecnico aperto');
      } catch (error) {
        valueBox.textContent = error.message;
        apriBtn.disabled = false;
        apriBtn.textContent = 'Apri intervento';
      }
    });
  }

  const saveContactBtn = $('#saveContactBtn');
  if (saveContactBtn && caller.phone) {
    saveContactBtn.addEventListener('click', async () => {
      const defaultName =
        caller.name && caller.name !== 'Non fornito' ? caller.name : caller.company || '';
      const name = window.prompt('Nome del contatto da salvare in rubrica:', defaultName);
      if (!name || !name.trim()) return;
      saveContactBtn.disabled = true;
      try {
        await api('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            company: caller.company || '',
            phone: caller.phone,
            email: caller.email || '',
            source: 'ticket'
          })
        });
        saveContactBtn.textContent = 'In rubrica ✓';
        toast(`Contatto ${name.trim()} salvato in rubrica`);
      } catch (error) {
        saveContactBtn.disabled = false;
        toast(error.message, true);
      }
    });
  }

  const blockBtn = $('#blockCallerBtn');
  if (blockBtn && caller.phone) {
    blockBtn.addEventListener('click', async () => {
      if (!window.confirm(`Bloccare le chiamate future da ${caller.phone}?`)) return;
      blockBtn.disabled = true;
      try {
        await api('/api/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: caller.phone,
            note: `Bloccato da ticket ${ticket.id}`
          })
        });
        blockBtn.textContent = 'Bloccato ✓';
        toast(`Numero ${caller.phone} bloccato`);
      } catch (error) {
        blockBtn.disabled = false;
        toast(error.message, true);
      }
    });
  }

  $('#deleteTicket').addEventListener('click', async () => {
    if (!window.confirm(`Eliminare definitivamente il ticket ${ticket.id}?`)) return;
    try {
      await api(`/api/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE' });
      toast('Ticket eliminato');
      closeDrawer();
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

async function openTicket(id) {
  try {
    const ticket = await api(`/api/tickets/${encodeURIComponent(id)}`);
    state.selectedId = id;
    renderDrawer(ticket);
    $('#drawer').classList.remove('hidden');
    $('#drawerBackdrop').classList.remove('hidden');
  } catch (error) {
    toast(error.message, true);
  }
}

function closeDrawer() {
  state.selectedId = null;
  $('#drawer').classList.add('hidden');
  $('#drawerBackdrop').classList.add('hidden');
}

function bindEvents() {
  $('#ticketsBody').addEventListener('click', (event) => {
    if (event.target.closest('.status-select')) return;
    const row = event.target.closest('tr[data-id]');
    if (row) openTicket(row.dataset.id);
  });

  $('#ticketsBody').addEventListener('change', (event) => {
    const select = event.target.closest('.status-select');
    if (!select) return;
    patchTicket(select.dataset.statusId, { status: select.value });
  });

  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.q = $('#search').value.trim();
      refresh();
    }, 250);
  });

  const filterMap = {
    statusFilter: 'status',
    reasonFilter: 'reason',
    productFilter: 'product'
  };

  for (const [elementId, filterKey] of Object.entries(filterMap)) {
    $(`#${elementId}`).addEventListener('change', (event) => {
      state.filters[filterKey] = event.target.value;
      refresh();
    });
  }

  $('#clearFilters').addEventListener('click', () => {
    state.filters = { q: '', status: '', reason: '', product: '' };
    $('#search').value = '';
    $('#statusFilter').value = '';
    $('#reasonFilter').value = '';
    $('#productFilter').value = '';
    refresh();
  });

  $('#exportBtn').addEventListener('click', () => {
    const params = filterQuery();
    const suffix = params.toString() ? `?${params.toString()}` : '';
    window.location.href = `/api/export.csv${suffix}`;
  });

  $('#refreshBtn').addEventListener('click', () => {
    refresh();
    loadForward();
  });

  $('#modeVirtuale').addEventListener('click', () => setMode('virtuale'));
  $('#modeInoltro').addEventListener('click', () => setMode('inoltro'));
  $('#voipStrategy').addEventListener('change', (event) => setVoipStrategy(event.target.value));
  $('#forwardSave').addEventListener('click', saveForwardNumber);
  $('#copyTimCode').addEventListener('click', copyTimCode);

  $('#scheduleSave').addEventListener('click', saveSchedule);
  $('#slotAdd').addEventListener('click', addSlot);
  $('#scheduleSlots').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-remove-slot]');
    if (!btn) return;
    removeSlot(Number(btn.dataset.removeSlot));
  });

  $('#autoRefresh').addEventListener('change', (event) => {
    state.autoRefresh = event.target.checked;
  });

  $('#drawer').addEventListener('click', (event) => {
    if (event.target.closest('[data-close-drawer]')) closeDrawer();
  });

  $('#drawerBackdrop').addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selectedId) closeDrawer();
  });
}

async function init() {
  bindEvents();
  try {
    await Promise.all([loadMeta(), loadTwilioStatus(), loadForward(), loadSchedule()]);
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }

  state.timer = setInterval(() => {
    if (state.autoRefresh && !document.hidden) {
      refresh();
      loadForward();
    }
  }, 5000);
}

init();

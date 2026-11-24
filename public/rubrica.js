const $ = (sel) => document.querySelector(sel);

const state = {
  items: [],
  q: ''
};

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

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

function renderContacts() {
  const body = $('#contactsBody');
  const empty = $('#contactsEmpty');
  const items = state.items || [];

  $('#contactsCountPill').textContent = `${items.length} contatt${items.length === 1 ? 'o' : 'i'}`;
  $('#rubricaSubtitle').textContent = `${items.length} contatt${items.length === 1 ? 'o' : 'i'} in rubrica`;

  if (!items.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  body.innerHTML = items
    .map((c) => {
      const phones = [c.phone, c.phone2].filter(Boolean).map(escapeHtml).join('<br/>');
      const extra = [c.email, c.note].filter(Boolean).map(escapeHtml).join(' · ') || '—';
      return `<tr>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.company || '—')}</td>
        <td>${phones}</td>
        <td class="muted">${extra}</td>
        <td><span class="badge">${escapeHtml(c.source || 'manuale')}</span></td>
        <td style="text-align: right; white-space: nowrap">
          <button class="btn btn-ghost" type="button" data-edit-id="${escapeHtml(c.id)}" style="padding:5px 9px;font-size:12px">Modifica</button>
          <button class="btn btn-ghost" type="button" data-block-id="${escapeHtml(c.id)}" style="padding:5px 9px;font-size:12px;color:var(--red)">Blocca</button>
          <button class="btn btn-ghost" type="button" data-delete-id="${escapeHtml(c.id)}" style="padding:5px 9px;font-size:12px">Elimina</button>
        </td>
      </tr>`;
    })
    .join('');
}

async function loadContacts() {
  try {
    const suffix = state.q ? `?q=${encodeURIComponent(state.q)}` : '';
    const data = await api(`/api/contacts${suffix}`);
    state.items = data.items || [];
    renderContacts();
  } catch (err) {
    toast(err.message, true);
  }
}

function resetForm() {
  $('#ctId').value = '';
  $('#ctName').value = '';
  $('#ctPhone').value = '';
  $('#ctCompany').value = '';
  $('#ctPhone2').value = '';
  $('#ctEmail').value = '';
  $('#ctNote').value = '';
  $('#contactFormTitle').textContent = '1. Nuovo contatto';
  $('#ctSubmitBtn').textContent = 'Salva contatto';
  $('#ctCancelEditBtn').classList.add('hidden');
}

function fillFormForEdit(contact) {
  $('#ctId').value = contact.id;
  $('#ctName').value = contact.name || '';
  $('#ctPhone').value = contact.phone || '';
  $('#ctCompany').value = contact.company || '';
  $('#ctPhone2').value = contact.phone2 || '';
  $('#ctEmail').value = contact.email || '';
  $('#ctNote').value = contact.note || '';
  $('#contactFormTitle').textContent = `Modifica contatto: ${contact.name}`;
  $('#ctSubmitBtn').textContent = 'Aggiorna contatto';
  $('#ctCancelEditBtn').classList.remove('hidden');
  $('#ctName').focus();
}

async function saveContact(event) {
  event.preventDefault();
  const id = $('#ctId').value.trim();
  const payload = {
    name: $('#ctName').value.trim(),
    phone: $('#ctPhone').value.trim(),
    company: $('#ctCompany').value.trim(),
    phone2: $('#ctPhone2').value.trim(),
    email: $('#ctEmail').value.trim(),
    note: $('#ctNote').value.trim(),
    source: 'manuale'
  };

  try {
    if (id) {
      await api(`/api/contacts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('Contatto aggiornato');
    } else {
      await api('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      toast('Contatto salvato in rubrica');
    }
    resetForm();
    await loadContacts();
  } catch (err) {
    toast(err.message, true);
  }
}

async function runImport() {
  const text = $('#importText').value.trim();
  if (!text) {
    toast('Carica un file o incolla i contatti da importare', true);
    return;
  }
  $('#importBtn').disabled = true;
  try {
    const res = await api('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, format: 'auto', source: 'messagenet' })
    });
    $('#importSummary').textContent = `Importazione completata: ${res.imported} nuovi, ${res.updated} aggiornati, ${res.skipped} ignorati (totale in rubrica: ${res.total}).`;
    toast(`Importati ${res.imported} nuovi contatti`);
    await loadContacts();
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#importBtn').disabled = false;
  }
}

function bindEvents() {
  $('#contactForm').addEventListener('submit', saveContact);
  $('#ctCancelEditBtn').addEventListener('click', resetForm);

  $('#importFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      $('#importText').value = content;
      $('#importSummary').textContent = `File caricato: ${file.name}. Premi "Importa contatti" per confermare.`;
    } catch {
      toast('Impossibile leggere il file selezionato', true);
    }
  });

  $('#importBtn').addEventListener('click', runImport);
  $('#importClearBtn').addEventListener('click', () => {
    $('#importFile').value = '';
    $('#importText').value = '';
    $('#importSummary').textContent = '';
  });

  let searchTimer = null;
  $('#ctSearch').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = event.target.value.trim();
      loadContacts();
    }, 200);
  });

  $('#ctRefreshBtn').addEventListener('click', loadContacts);

  $('#contactsBody').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-id]');
    if (editBtn) {
      const contact = state.items.find((c) => c.id === editBtn.dataset.editId);
      if (contact) fillFormForEdit(contact);
      return;
    }

    const blockBtn = event.target.closest('[data-block-id]');
    if (blockBtn) {
      const contact = state.items.find((c) => c.id === blockBtn.dataset.blockId);
      if (!contact) return;
      if (!window.confirm(`Bloccare le chiamate da ${contact.name} (${contact.phone})?`)) return;
      try {
        await api('/api/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: contact.phone, note: contact.name })
        });
        toast(`Numero ${contact.phone} bloccato`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    const delBtn = event.target.closest('[data-delete-id]');
    if (delBtn) {
      const contact = state.items.find((c) => c.id === delBtn.dataset.deleteId);
      if (!contact) return;
      if (!window.confirm(`Eliminare ${contact.name} dalla rubrica?`)) return;
      try {
        await api(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: 'DELETE' });
        toast('Contatto eliminato');
        await loadContacts();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });
}

bindEvents();
loadContacts();

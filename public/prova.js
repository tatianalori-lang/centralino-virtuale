const state = {
  sessionId: null,
  busy: false,
  done: false
};

const chat = document.getElementById('chat');
const optionsBox = document.getElementById('chatOptions');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

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

function addMessage(text, kind = 'bot') {
  const element = document.createElement('div');
  element.className = `msg ${kind}`;
  element.textContent = text;
  chat.appendChild(element);
  chat.scrollTop = chat.scrollHeight;
  return element;
}

function setOptions(options) {
  optionsBox.innerHTML = '';
  if (!options) return;

  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option-btn';
    button.textContent = `${option.key} · ${option.value}`;
    button.addEventListener('click', () => send(option.key, `${option.key} · ${option.value}`));
    optionsBox.appendChild(button);
  }
}

function setFormEnabled(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) input.focus();
}

function handleState(data) {
  if (data.error) {
    addMessage(`Il centralino non ha capito: ${data.error} Riprova.`, 'system');
  }

  if (data.done) {
    state.done = true;
    setOptions(null);
    setFormEnabled(false);
    const element = addMessage(
      `Richiesta registrata con il numero ${data.ticketId}. Sarai contattato al più presto.`,
      'success'
    );
    element.appendChild(document.createElement('br'));
    const link = document.createElement('a');
    link.href = '/';
    link.textContent = 'Apri la dashboard →';
    element.appendChild(link);
    chat.scrollTop = chat.scrollHeight;
    return;
  }

  addMessage(data.prompt, 'bot');
  setOptions(data.options);
}

async function send(answer, display) {
  if (state.busy || state.done || !state.sessionId) return;

  const value = String(answer ?? '').trim();
  if (!value) return;

  addMessage(display || value, 'user');
  setOptions(null);
  state.busy = true;
  setFormEnabled(false);

  try {
    const data = await api('/api/simulate/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, answer: value })
    });
    handleState(data);
  } catch (error) {
    addMessage(error.message, 'system');
  } finally {
    state.busy = false;
    input.value = '';
    if (!state.done) setFormEnabled(true);
  }
}

async function start() {
  state.busy = true;
  state.done = false;
  state.sessionId = null;
  chat.innerHTML = '';
  optionsBox.innerHTML = '';
  input.value = '';
  setFormEnabled(false);
  addMessage('Chiamata in corso…', 'system');

  try {
    const data = await api('/api/simulate/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    state.sessionId = data.sessionId;
    handleState(data);
  } catch (error) {
    addMessage(error.message, 'system');
  } finally {
    state.busy = false;
    if (!state.done) setFormEnabled(true);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  send(input.value);
});

document.getElementById('restartBtn').addEventListener('click', start);

start();

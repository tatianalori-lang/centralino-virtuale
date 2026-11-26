import { config } from './config.js';
import { requiresProduct } from './flow.js';

/**
 * Prompt usati dai campioni audio e dalle chiamate demo.
 * Rispettano la stessa regola dell'IVR: la richiesta generica sul
 * prodotto/servizio viene inclusa solo quando il motivo è "Assistenza tecnica".
 * Non è previsto alcun passo di conferma: il ticket viene creato alla fine
 * della raccolta dati.
 */
export function demoPrompts(reason = 'Assistenza tecnica') {
  const prompts = [
    `${config.welcomeMessage}. Per quale motivo ci contatta? Dica assistenza tecnica, informazioni commerciali, amministrazione, oppure altro.`
  ];

  if (requiresProduct({ reason })) {
    prompts.push(
      'Mi dica su quale prodotto o servizio richiede assistenza.',
      'Descriva brevemente la problematica riscontrata.'
    );
  } else {
    prompts.push('Descriva brevemente la sua richiesta.');
  }

  prompts.push(
    'Mi dica il suo nome.',
    'Mi dica il nome della sua azienda.',
    'Mi dica il suo indirizzo.',
    "Grazie. La sua richiesta è stata registrata. Sarà contattato al più presto. Le ricordiamo i nostri orari di apertura: dal lunedì al venerdì dalle 8:30 alle 13:00 e dalle 14:30 alle 17:00, e il sabato dalle 8:30 alle 13:00. Per richieste di assistenza urgenti fuori dagli orari lavorativi, inviare un'email ad assistenza@mtitaliaretail.com. Grazie e arrivederci."
  );

  return prompts;
}

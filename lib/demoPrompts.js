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
    `${config.welcomeMessage}. Per quale motivo ci contatta? Dica assistenza tecnica, informazioni commerciali, amministrazione e fatturazione, oppure altro.`
  ];

  if (requiresProduct({ reason })) {
    prompts.push(
      'Mi dica su quale prodotto o servizio richiede assistenza, oppure dica salta.'
    );
  }

  prompts.push(
    'Descriva brevemente il problema o la richiesta, oppure dica salta.',
    'Mi dica il suo nome, oppure dica salta.',
    'Mi dica il suo indirizzo, oppure dica salta.',
    'Grazie. La sua richiesta è stata registrata. Sarà contattato al più presto. Arrivederci.'
  );

  return prompts;
}

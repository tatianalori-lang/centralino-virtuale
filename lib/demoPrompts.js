import { config } from './config.js';
import { requiresProduct } from './flow.js';

/**
 * Prompt usati dai campioni audio e dalle chiamate demo.
 * Rispettano la stessa regola dell'IVR: la richiesta generica sul
 * prodotto/servizio viene inclusa solo quando il motivo è "Assistenza tecnica".
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
    'Mi descriva brevemente la problematica, oppure dica salta.',
    'La sua richiesta è pronta. Dica conferma per inviare la richiesta.',
    'Grazie. La sua richiesta è stata registrata. Sarà contattato al più presto. Arrivederci.'
  );

  return prompts;
}

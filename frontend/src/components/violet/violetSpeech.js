// Convierte el texto de una respuesta en un guion de boca y de énfasis.
// No hay voz: esto da ritmo creíble a partir de las letras, no sincroniza con ningún audio.
const VOWELS = {
  a: 'aa', á: 'aa', e: 'ee', é: 'ee', i: 'ih', í: 'ih', y: 'ih', o: 'oh', ó: 'oh', u: 'ou', ú: 'ou', ü: 'ou',
};
const VOWEL_OPENING = { aa: 0.85, oh: 0.72, ee: 0.62, ih: 0.55, ou: 0.58 };
const CLOSED_LIPS = new Set(['m', 'b', 'p']);
const ACCENTED = new Set(['á', 'é', 'í', 'ó', 'ú']);
const PAUSES = {
  ',': [0.2, 'phrase'], ';': [0.24, 'phrase'], ':': [0.24, 'phrase'], '\n': [0.3, 'phrase'],
  '.': [0.38, 'end'], '!': [0.38, 'exclaim'], '?': [0.4, 'ask'],
};
const MIN_SECONDS = 1.5;
const MAX_SECONDS = 12;

// Lo que no se pronuncia: bloques de código, código en línea, enlaces y marcas de formato.
function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, '. ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>|~[\]()]/g, ' ');
}

export function buildSpeech(text) {
  const segments = [];
  const beats = [];
  let at = 0;
  let last = 'aa';
  const push = (seconds, viseme, amount) => {
    segments.push({ start: at, end: at + seconds, viseme, amount });
    at += seconds;
  };

  // Una leve variación por posición evita que todas las sílabas midan y abran lo mismo.
  [...speakable(text).toLowerCase()].forEach((char, index) => {
    const jitter = ((index * 7919) % 100) / 100;
    if (VOWELS[char]) {
      last = VOWELS[char];
      const stressed = ACCENTED.has(char);
      if (stressed) beats.push({ at, kind: 'stress' });
      push((stressed ? 0.13 : 0.085) + jitter * 0.03, last, VOWEL_OPENING[last] * (stressed ? 1.1 : 0.82 + jitter * 0.18));
    } else if (CLOSED_LIPS.has(char)) {
      push(0.055, last, 0);
    } else if (/[a-zñ]/.test(char)) {
      push(0.05, last, 0.14);
    } else if (/\d/.test(char)) {
      push(0.1, jitter > 0.5 ? 'ee' : 'oh', 0.6);
    } else if (PAUSES[char]) {
      const [seconds, kind] = PAUSES[char];
      beats.push({ at, kind });
      if (seconds) push(seconds, last, 0);
    } else if (/\s/.test(char)) {
      push(0.03, last, 0.05);
    }
  });

  return { segments, beats, duration: at };
}

// Cuánto dura el estado `talking`: lo que tarda el guion, con un mínimo y un tope para respuestas largas.
export function speechDurationMs(text) {
  return Math.round(Math.min(Math.max(buildSpeech(text).duration, MIN_SECONDS), MAX_SECONDS) * 1000);
}

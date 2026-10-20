// Shared helpers for scripts/ocr-offers.mjs (pure functions, tested without Tesseract).
// The same rules as ocrPass in supabase/functions/jobs-sync and textToHtml in supabase/functions/_shared/ocr.ts.

export const OCR_SOURCES = ['mediacongo', 'ubscongo', 'kivu10'];

const unescape = (v) =>
  v.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export const visibleText = (html) => unescape(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Images and PDF of an offer that is mostly an image or a scan; null when it already has real text. */
export const filesToRead = (row) => {
  const html = String(row.description ?? '');
  if (html.includes('data-ocr')) return null;
  const images = [...html.matchAll(/<img\b[^>]*src="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]).filter((u) => !/logo|banner|pub|ads?\//i.test(u));
  const pdf = row.source === 'kivu10' && /\.pdf(\?|$)/i.test(row.url ?? '') ? row.url : (html.match(/href="(https?:\/\/[^"]+\.pdf)"/i)?.[1] ?? null);
  if (!images.length && !pdf) return null;
  const text = visibleText(html.replace(/<p><strong>Date limite :<\/strong>[^<]*<\/p>/, ''));
  return text.length < 400 ? { images: images.slice(0, 8), pdf } : null;
};

const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BULLET = /^\s*([-•▪●◦■□➢➤►✓✔*]|\d{1,2}[.)])\s+/;

/** OCR text -> <h3> / <p> / <ul><li>. Short lines in capitals or ending with ":" read as headings. */
export const textToHtml = (text) => {
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let para = [];
    let list = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(esc).join(' ')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
      list = [];
    };
    for (const line of lines) {
      const letters = line.replace(/[^\p{L}]/gu, '');
      if (line.length <= 70 && (/:$/.test(line) || (letters.length >= 4 && letters === letters.toUpperCase()))) {
        flushPara();
        flushList();
        out.push(`<h3>${esc(line.replace(/:$/, ''))}</h3>`);
      } else if (BULLET.test(line)) {
        flushPara();
        list.push(line.replace(BULLET, ''));
      } else if (list.length && /^[a-zà-ÿ(]/.test(line)) {
        list[list.length - 1] += ` ${line}`; // list item wrapped on the next line
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
  }
  return out.join('');
};

/** Final description: read text first (with a note), original images / links kept below. */
export const withOcr = (html, text, fromPdf) =>
  text
    ? `<div data-ocr="1"><p><em>Texte de l’offre lu automatiquement depuis ${fromPdf ? 'le document' : 'l’image'}. En cas de doute, l’original ci-dessous fait foi.</em></p>${text}</div>${html}`
    : `${html}<div data-ocr="0"></div>`; // nothing readable: never retried

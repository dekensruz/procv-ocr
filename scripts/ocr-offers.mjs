// Reads the text of job offers published as images or scanned PDFs, with Tesseract (free, open source, no AI),
// and stores it in external_jobs.description. Run by .github/workflows/ocr-offers.yml every 2 hours.
// Needs: tesseract (+ French data) and pdftoppm (poppler) on the machine, and two environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: OCR_LIMIT (offers per run, default 40).
// Node 18+ (global fetch), no npm dependency.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { filesToRead, OCR_SOURCES, textToHtml, withOcr } from './ocr-lib.mjs';

const run = promisify(execFile);
const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const LIMIT = Number(process.env.OCR_LIMIT ?? 40);
const MAX_PDF_PAGES = 6;
if (!URL_ || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const rest = async (path, init = {}) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const pending = async () => {
  const base = `external_jobs?select=id,source,url,description&source=in.(${OCR_SOURCES.join(',')})&description=not.like.*data-ocr*&order=published_at.desc.nullslast&limit=300`;
  try {
    return await rest(`${base}&duplicate_of=is.null`); // hidden duplicates are not worth reading
  } catch {
    return rest(base); // before migration 20261022000000
  }
};

const download = async (url, file) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProCV/1.0; +https://monprocv.com)' } });
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
};

const tesseract = async (image) => {
  const { stdout } = await run('tesseract', [image, 'stdout', '-l', 'fra+eng', '--psm', '3'], { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
};

const readOffer = async ({ images, pdf }, dir) => {
  const parts = [];
  if (pdf) {
    const file = join(dir, 'offer.pdf');
    await download(pdf, file);
    // Text layer first (typed PDFs need no OCR), then page images for scans.
    const { stdout: layer } = await run('pdftotext', ['-l', String(MAX_PDF_PAGES), '-layout', file, '-']).catch(() => ({ stdout: '' }));
    if (layer.replace(/\s+/g, ' ').trim().length > 200) parts.push(layer);
    else {
      await run('pdftoppm', ['-r', '200', '-png', '-l', String(MAX_PDF_PAGES), file, join(dir, 'page')]);
      const pages = (await readdir(dir)).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort();
      for (const p of pages) parts.push(await tesseract(join(dir, p)));
    }
  }
  for (const [i, url] of images.entries()) {
    const file = join(dir, `img${i}`);
    await download(url, file);
    parts.push(await tesseract(file));
  }
  const text = parts.join('\n\n').trim();
  return text.replace(/\s+/g, ' ').length > 60 ? textToHtml(text) : '';
};

const rows = (await pending()).map((r) => ({ ...r, files: filesToRead(r) })).filter((r) => r.files).slice(0, LIMIT);
console.log(`${rows.length} offers to read`);
let read = 0;
let empty = 0;
let failed = 0;
for (const row of rows) {
  const dir = await mkdtemp(join(tmpdir(), 'ocr-'));
  try {
    const text = await readOffer(row.files, dir);
    const description = withOcr(String(row.description ?? ''), text, !!row.files.pdf && !row.files.images.length);
    await rest(`external_jobs?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ description }), headers: { Prefer: 'return=minimal' } });
    text ? read++ : empty++;
    console.log(`${text ? 'read ' : 'empty'} ${row.id}`);
  } catch (err) {
    failed++; // download or OCR problem: retried on the next run
    console.warn(`failed ${row.id}: ${err.message?.slice(0, 200)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
console.log(`done: ${read} read, ${empty} without text, ${failed} failed`);

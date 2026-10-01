import type { IAppModule, ModuleMigrations } from '../types';

export type OCRReceipt = { rawText: string; date: string | null; vendor: string | null; total: number | null; confidence?: number };
type TesseractResult = { data?: { text?: string; confidence?: number } };
type TesseractWorker = { recognize(image: Blob): Promise<TesseractResult>; terminate?(): Promise<void> };
type TesseractAPI = { recognize(image: Blob, language: string): Promise<TesseractResult>; createWorker?(language: string): Promise<TesseractWorker> };

declare global { interface Window { Tesseract?: TesseractAPI } }

function parseDate(text: string): string | null {
  const match = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (!match) return null;
  if (match[1]) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const year = match[6].length === 2 ? `20${match[6]}` : match[6];
  return `${year}-${match[5].padStart(2, '0')}-${match[4].padStart(2, '0')}`;
}

function parseTotal(text: string): number | null {
  const matches = [...text.matchAll(/(?:total|amount due|balance)\s*[:$€£]?\s*([0-9]+(?:[.,][0-9]{1,2})?)/ig)];
  const raw = matches.at(-1)?.[1] ?? [...text.matchAll(/[$€£]\s*([0-9]+(?:[.,][0-9]{1,2})?)/g)].at(-1)?.[1];
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseVendor(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => !/receipt|invoice|total|date|amount due|\d{3,}/i.test(line)) ?? lines[0] ?? null;
}

export class OCRScannerModule implements IAppModule {
  readonly id = 'ocr-scanner';
  readonly name = 'Receipt scanner';
  readonly description = 'Extract receipt fields locally with Tesseract.js; images never leave the device.';
  readonly isEnabledByDefault = true;

  getMigrations(): ModuleMigrations { return { sqlite: [], postgres: [] }; }

  async scan(image: Blob): Promise<OCRReceipt> {
    if (typeof window === 'undefined' || !window.Tesseract) throw new Error('Tesseract.js is not loaded. Load it locally before scanning.');
    const api = window.Tesseract;
    let result: TesseractResult;
    if (api.createWorker) {
      const worker = await api.createWorker('eng');
      try { result = await worker.recognize(image); } finally { await worker.terminate?.(); }
    } else {
      result = await api.recognize(image, 'eng');
    }
    const rawText = result.data?.text?.trim() ?? '';
    return { rawText, date: parseDate(rawText), vendor: parseVendor(rawText), total: parseTotal(rawText), confidence: result.data?.confidence };
  }

  async exportModuleData(_userId: string): Promise<Record<string, unknown>> { return { scans: [] }; }
  async importModuleData(_userId: string, _data: Record<string, unknown>): Promise<void> { return undefined; }
}

export default OCRScannerModule;

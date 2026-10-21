import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { PdfReportUpload } from "../src/types/adminDb.ts";

const PDF_DIRECTORY = path.resolve(process.cwd(), "data", "report-pdfs");

export function storePdfReport(
  buffer: Buffer,
  campaignId: string,
  originalName: string
): PdfReportUpload {
  const id = randomUUID();
  const nomeArquivo = path.basename(originalName).trim();
  if (!nomeArquivo || nomeArquivo.length > 240 || !/\.pdf$/i.test(nomeArquivo)) {
    throw new Error("O nome do arquivo PDF é inválido.");
  }
  fs.mkdirSync(PDF_DIRECTORY, { recursive: true });
  fs.writeFileSync(path.join(PDF_DIRECTORY, `${id}.pdf`), buffer, { flag: "wx" });
  return {
    id,
    campanhaId: campaignId,
    nomeArquivo,
    criadoEm: new Date().toISOString(),
    status: "analisando",
  };
}

export function removeStoredPdf(uploadId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(uploadId)) return;
  const filePath = path.join(PDF_DIRECTORY, `${uploadId}.pdf`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function readStoredPdf(uploadId: string): Buffer {
  if (!/^[a-f0-9-]{36}$/i.test(uploadId)) {
    throw new Error("Identificador do PDF armazenado é inválido.");
  }
  const filePath = path.join(PDF_DIRECTORY, `${uploadId}.pdf`);
  const buffer = fs.readFileSync(filePath);
  if (!buffer.length || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("O arquivo PDF armazenado está vazio ou inválido.");
  }
  return buffer;
}

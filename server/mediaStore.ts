import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { VideoPortal } from "../src/types/adminDb.ts";

const MEDIA_DIRECTORY = path.resolve(process.cwd(), "data", "media");
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export interface UploadedMedia {
  buffer: Buffer;
  fileName: string;
  mimeType: VideoPortal["mimeType"];
  title: string;
  description: string;
}

export function validateUploadedMedia(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  title: string,
  description: string
): UploadedMedia {
  const fileName = path.basename(originalName).trim();
  const extension = path.extname(fileName).toLowerCase();
  const mimeByExtension: Record<string, VideoPortal["mimeType"]> = {
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  const mimeType = mimeByExtension[extension];
  if (!mimeType || contentType.toLowerCase() !== mimeType) {
    throw new Error("Envie somente arquivos MP4, PNG ou JPG com o tipo de arquivo correspondente.");
  }
  if (!fileName || fileName.length > 240) {
    throw new Error("O nome do arquivo é inválido ou excede 240 caracteres.");
  }
  if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
    throw new Error("O arquivo de mídia deve ter até 100 MB.");
  }
  const validSignature =
    mimeType === "video/mp4"
      ? buffer.length >= 16 &&
        buffer.toString("ascii", 4, 8) === "ftyp" &&
        (buffer.includes(Buffer.from("mdat")) || buffer.includes(Buffer.from("moov")))
      : mimeType === "image/png"
        ? buffer.length >= 45 &&
          buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          buffer.toString("ascii", 12, 16) === "IHDR" &&
          buffer.readUInt32BE(16) > 0 &&
          buffer.readUInt32BE(20) > 0 &&
          buffer.includes(Buffer.from("IDAT")) &&
          buffer.subarray(-8, -4).toString("ascii") === "IEND"
        : buffer.length >= 3 &&
          buffer[0] === 0xff &&
          buffer[1] === 0xd8 &&
          buffer[2] === 0xff &&
          buffer.length >= 16 &&
          buffer[buffer.length - 2] === 0xff &&
          buffer[buffer.length - 1] === 0xd9;
  if (!validSignature) {
    throw new Error("O conteúdo do arquivo não corresponde a um MP4, PNG ou JPG válido.");
  }
  if (!title.trim() || title.trim().length > 120) {
    throw new Error("Informe um título de até 120 caracteres.");
  }
  if (description.length > 2000) {
    throw new Error("A descrição deve ter no máximo 2.000 caracteres.");
  }
  return {
    buffer,
    fileName,
    mimeType,
    title: title.trim(),
    description: description.trim(),
  };
}

export function storeUploadedMedia(upload: UploadedMedia, campanhaId: string): VideoPortal {
  const arquivoId = randomUUID();
  fs.mkdirSync(MEDIA_DIRECTORY, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIRECTORY, arquivoId), upload.buffer, { flag: "wx" });
  return {
    id: randomUUID(),
    campanhaId,
    titulo: upload.title,
    descricao: upload.description,
    arquivoId,
    nomeArquivo: upload.fileName,
    mimeType: upload.mimeType,
    tamanhoBytes: upload.buffer.length,
  };
}

export function readStoredMedia(arquivoId: string): Buffer | undefined {
  if (!/^[a-f0-9-]{36}$/i.test(arquivoId)) return undefined;
  const filePath = path.join(MEDIA_DIRECTORY, arquivoId);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
}

export function removeStoredMedia(arquivoId: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(arquivoId)) return;
  const filePath = path.join(MEDIA_DIRECTORY, arquivoId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function getMediaMaxBytes(): number {
  return MAX_MEDIA_BYTES;
}

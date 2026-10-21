import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RelatorioData } from "../src/types/whiteVision.ts";

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARACTERS = 20_000_000;

export class PdfEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfEvidenceError";
  }
}

function normalizeEvidence(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function assertEvidencePresent(
  pages: string[],
  evidence: string,
  description: string,
  pageNumber?: number
): void {
  if (typeof evidence !== "string") {
    throw new PdfEvidenceError(`Evidência inválida para ${description}.`);
  }
  if (!evidence.trim()) return;
  const normalizedEvidence = normalizeEvidence(evidence);
  const candidatePages =
    pageNumber === undefined
      ? pages
      : Number.isSafeInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pages.length
        ? [pages[pageNumber - 1]]
        : [];

  if (
    !normalizedEvidence ||
    !candidatePages.some((page) => normalizeEvidence(page).includes(normalizedEvidence))
  ) {
    throw new PdfEvidenceError(
      `A evidência de ${description} não corresponde ao texto extraído do PDF${pageNumber ? ` na página ${pageNumber}` : ""}.`
    );
  }
}

export async function verifyPdfEvidence(
  pdfBuffer: Buffer,
  report: RelatorioData
): Promise<void> {
  let document;
  try {
    document = await getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
  } catch {
    throw new PdfEvidenceError("Não foi possível ler o texto do PDF enviado.");
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfEvidenceError(`PDF excede o limite de ${MAX_PDF_PAGES} páginas para conferência.`);
    }

    const pages: string[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ");
      characterCount += text.length;
      if (characterCount > MAX_EXTRACTED_CHARACTERS) {
        throw new PdfEvidenceError("PDF excede o limite de texto para conferência.");
      }
      pages.push(text);
      page.cleanup();
    }

    if (!pages.some((page) => page.trim())) {
      throw new PdfEvidenceError(
        "O PDF não contém texto selecionável para validar as evidências. PDFs escaneados precisam de OCR antes da importação."
      );
    }

    const evidence = report.evidencias || {};
    for (const [field, quote] of Object.entries(evidence)) {
      if (typeof quote === "string") {
        assertEvidencePresent(pages, quote, field);
      }
    }

    for (const local of report.locais || []) {
      assertEvidencePresent(pages, local.evidenciaEndereco || "", `endereço de ${local.nome}`);
      assertEvidencePresent(
        pages,
        local.evidenciaHorarioFuncionamento || "",
        `horário de ${local.nome}`
      );
      assertEvidencePresent(
        pages,
        local.evidenciaFrequenciaLocal || "",
        `frequência de ${local.nome}`
      );
      for (const screen of local.telas || []) {
        assertEvidencePresent(
          pages,
          screen.evidenciaMetaDiaria || "",
          `meta diária de ${screen.nome}`
        );
        assertEvidencePresent(
          pages,
          screen.evidenciaStatus || "",
          `status de ${screen.nome}`
        );
      }
    }

    for (const day of report.historicoDiario || []) {
      for (const screen of day.telas || []) {
        assertEvidencePresent(
          pages,
          screen.evidencia,
          `contagem de ${screen.telaNome} em ${day.dia}`,
          screen.pagina
        );
        assertEvidencePresent(
          pages,
          screen.evidenciaStatus || "",
          `status de ${screen.telaNome} em ${day.dia}`,
          screen.pagina
        );
      }
    }
  } finally {
    await document.destroy();
  }
}

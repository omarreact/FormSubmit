/**
 * Client-side file scan for uploaded documents (esp. Apostille copies).
 * Inspects type, size, page count (PDF), dimensions (images), and readiness.
 * Does not call external OCR APIs — runs fully in the browser.
 */

import { formatFileSize } from "./file-utils.js";

export async function scanFile(file) {
  const notes = [];
  const sizeLabel = formatFileSize(file.size);
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();

  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  const isImage =
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    mime.includes("png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png");

  if (!isPdf && !isImage) {
    return {
      status: "error",
      summary: "Unsupported file type",
      fileType: "unknown",
      sizeLabel,
      notes: ["Only PDF, JPG, or PNG are accepted."],
    };
  }

  try {
    const buffer = await file.arrayBuffer();

    if (isPdf) {
      const pageCount = await countPdfPages(buffer);
      if (pageCount === 0) {
        return {
          status: "error",
          summary: "PDF has no pages",
          fileType: "pdf",
          pageCount: 0,
          sizeLabel,
          notes: ["File may be corrupted."],
        };
      }
      if (pageCount > 20) {
        notes.push("Large PDF — dossier may take longer to build.");
      }
      notes.push("Will be embedded page-by-page in the applicant dossier PDF.");
      if (/apostille|legaliz|notar/i.test(file.name)) {
        notes.push("Filename suggests apostille / legalization.");
      }

      return {
        status: "ok",
        summary: `PDF scanned · ${pageCount} page${pageCount === 1 ? "" : "s"}`,
        fileType: "pdf",
        pageCount,
        sizeLabel,
        notes,
      };
    }

    const dims = await getImageDimensions(buffer, mime || name);
    if (!dims) {
      return {
        status: "warning",
        summary: "Image loaded but dimensions unknown",
        fileType: "image",
        sizeLabel,
        notes: ["File will still be added to the dossier as a full page."],
      };
    }
    notes.push("Will be placed on an A4 page in the dossier PDF.");
    if (dims.width < 400 || dims.height < 400) {
      notes.push("Low resolution — consider a clearer scan.");
    }
    if (/apostille|legaliz|notar/i.test(file.name)) {
      notes.push("Filename suggests apostille / legalization.");
    }

    return {
      status: dims.width < 400 ? "warning" : "ok",
      summary: `Image scanned · ${dims.width}×${dims.height}px`,
      fileType: "image",
      width: dims.width,
      height: dims.height,
      sizeLabel,
      notes,
    };
  } catch (err) {
    return {
      status: "error",
      summary: "Scan failed",
      fileType: isPdf ? "pdf" : isImage ? "image" : "unknown",
      sizeLabel,
      notes: [err.message || "Could not read file"],
    };
  }
}

async function countPdfPages(arrayBuffer) {
  const { PDFDocument } = await import(
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
  );
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

function getImageDimensions(arrayBuffer, mimeOrName) {
  return new Promise((resolve) => {
    const isPng =
      String(mimeOrName).includes("png") || String(mimeOrName).endsWith(".png");
    const blob = new Blob([arrayBuffer], {
      type: isPng ? "image/png" : "image/jpeg",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      resolve({ width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function scanFiles(files) {
  const results = [];
  for (const f of files) {
    results.push(await scanFile(f));
  }
  return results;
}

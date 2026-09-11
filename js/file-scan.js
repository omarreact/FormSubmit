/**
 * Client-side file scan for uploaded documents (esp. Apostille copies).
 * Inspects type, size, page count (PDF), dimensions (images), and readiness.
 * Does not call external OCR APIs — runs fully in the browser.
 */

import { formatFileSize } from "./file-utils.js";

/**
 * @typedef {Object} ScanResult
 * @property {string} status - "ok" | "warning" | "error"
 * @property {string} summary - short human message
 * @property {string} fileType - pdf | image | unknown
 * @property {number} [pageCount]
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} sizeLabel
 * @property {string[]} notes
 * @property {string} [fileName]
 * @property {boolean} [apostilleLikely]
 */

/**
 * Scan from ArrayBuffer + filename/mime (used during PDF generation)
 * @param {ArrayBuffer} buffer
 * @param {{ fileName?: string, mimeType?: string, size?: number }} meta
 * @returns {Promise<ScanResult>}
 */
export async function scanArrayBuffer(buffer, meta = {}) {
  const notes = [];
  const fileName = meta.fileName || "document";
  const name = fileName.toLowerCase();
  const mime = (meta.mimeType || "").toLowerCase();
  const sizeLabel =
    typeof meta.size === "number"
      ? formatFileSize(meta.size)
      : formatFileSize(buffer?.byteLength || 0);

  const isPdf = mime.includes("pdf") || name.endsWith(".pdf");
  const isImage =
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    mime.includes("png") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png");

  const apostilleLikely = /apostille|legaliz|notar|attestation|mofa/i.test(fileName);

  if (!isPdf && !isImage) {
    return {
      status: "error",
      summary: "Unsupported file type",
      fileType: "unknown",
      sizeLabel,
      fileName,
      apostilleLikely,
      notes: ["Only PDF, JPG, or PNG are accepted."],
    };
  }

  try {
    if (isPdf) {
      const pageCount = await countPdfPages(buffer);
      if (pageCount === 0) {
        return {
          status: "error",
          summary: "PDF has no pages",
          fileType: "pdf",
          pageCount: 0,
          sizeLabel,
          fileName,
          apostilleLikely,
          notes: ["File may be corrupted."],
        };
      }
      if (pageCount > 20) {
        notes.push("Large PDF - dossier may take longer to build.");
      }
      notes.push("Embedded page-by-page in the applicant dossier PDF.");
      if (apostilleLikely) {
        notes.push("Filename suggests apostille / legalization / MOFA attestation.");
      }
      if (pageCount >= 2) {
        notes.push(
          "Multi-page file - often includes source document + attestation/apostille page(s)."
        );
      }
      notes.push("Verify seals, signatures, and attestation numbers on each page.");

      return {
        status: "ok",
        summary: `PDF scanned - ${pageCount} page${pageCount === 1 ? "" : "s"}`,
        fileType: "pdf",
        pageCount,
        sizeLabel,
        fileName,
        apostilleLikely,
        notes,
      };
    }

    // Image
    const dims = await getImageDimensions(buffer, mime || name);
    if (!dims) {
      return {
        status: "warning",
        summary: "Image loaded but dimensions unknown",
        fileType: "image",
        sizeLabel,
        fileName,
        apostilleLikely,
        notes: ["File will still be added to the dossier as a full page."],
      };
    }
    notes.push("Placed on an A4 page in the dossier PDF.");
    if (dims.width < 400 || dims.height < 400) {
      notes.push("Low resolution - consider a clearer scan.");
    }
    if (apostilleLikely) {
      notes.push("Filename suggests apostille / legalization / MOFA attestation.");
    }
    notes.push("Verify seals, signatures, and attestation numbers are readable.");

    return {
      status: dims.width < 400 ? "warning" : "ok",
      summary: `Image scanned - ${dims.width}x${dims.height}px`,
      fileType: "image",
      width: dims.width,
      height: dims.height,
      sizeLabel,
      fileName,
      apostilleLikely,
      notes,
    };
  } catch (err) {
    return {
      status: "error",
      summary: "Scan failed",
      fileType: isPdf ? "pdf" : isImage ? "image" : "unknown",
      sizeLabel,
      fileName,
      apostilleLikely,
      notes: [err.message || "Could not read file"],
    };
  }
}

/**
 * Scan a single File (PDF / JPG / PNG)
 * @param {File} file
 * @returns {Promise<ScanResult>}
 */
export async function scanFile(file) {
  const buffer = await file.arrayBuffer();
  return scanArrayBuffer(buffer, {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  });
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

/**
 * Scan many files in sequence
 * @param {File[]} files
 * @returns {Promise<ScanResult[]>}
 */
export async function scanFiles(files) {
  const results = [];
  for (const f of files) {
    results.push(await scanFile(f));
  }
  return results;
}

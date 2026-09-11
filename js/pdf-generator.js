/**
 * PDF Dossier Generator - core merging logic using pdf-lib
 * Produces a single self-contained PDF with summary + all uploaded pages.
 */

import { auditDocuments, sortDocumentsForPdf, groupByCategory } from "./document-audit.js";
import { DOCUMENT_RULES } from "./document-rules.js";
import { downloadDocumentAsArrayBuffer } from "./submissions.js";
import { computeSHA256 } from "./file-utils.js";
import { addSummaryPages, addSeparatorPage } from "./pdf-summary.js";
import { STATUS } from "./pdf-progress.js";
import { APP_CONFIG } from "./config.js";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

export async function generateApplicantPdf(submission, documents, onProgress, options = {}) {
  const progress = (p) => {
    if (typeof onProgress === "function") onProgress(p);
  };

  const warnings = [];
  const seenHashes = new Set();

  try {
    progress({ status: STATUS.AUDITING, percent: 5, message: "Validating applicant…" });

    const audit = auditDocuments(submission, documents);

    progress({ status: STATUS.AUDITING, percent: 10, message: "Auditing required documents…" });

    progress({ status: STATUS.FETCHING, percent: 15, message: "Loading document metadata…" });

    const sorted = sortDocumentsForPdf(documents);
    const groups = groupByCategory(sorted);

    const { PDFDocument, rgb } = await import(
      "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
    );

    const mergedPdf = await PDFDocument.create();
    mergedPdf.setTitle(
      `${submission.applicantName || "Applicant"} - Visa Application Dossier`
    );
    mergedPdf.setAuthor("Visa Application Document Submission System");
    mergedPdf.setCreator("Visa Dossier Generator");
    mergedPdf.setProducer("pdf-lib");
    mergedPdf.setCreationDate(new Date());

    progress({ status: STATUS.PROCESSING, percent: 20, message: "Creating checklist summary…" });
    await addSummaryPages(mergedPdf, submission, audit, { warnings: [] });

    const totalDocs = sorted.length;
    let processed = 0;
    let totalPagesAdded = 0;

    if (totalDocs === 0) {
      progress({ status: STATUS.FINALIZING, percent: 90, message: "No documents to merge…" });
    }

    for (const group of groups) {
      const rule = DOCUMENT_RULES[group.key];
      const order = rule ? rule.order : 999;
      const label = rule ? rule.label : group.key;

      if (group.docs.length > 0 && options.addSeparators !== false) {
        await addSeparatorPage(
          mergedPdf,
          order,
          label,
          submission.applicantName
        );
      }

      for (const docMeta of group.docs) {
        const basePercent = 25;
        const span = 60;
        const pct = basePercent + Math.round((processed / Math.max(totalDocs, 1)) * span);

        progress({
          status: STATUS.FETCHING,
          percent: pct,
          message: `Downloading: ${docMeta.fileName || docMeta.originalFileName || "file"}…`,
        });

        let arrayBuffer;
        try {
          if (docMeta._localArrayBuffer) {
            arrayBuffer = docMeta._localArrayBuffer;
          } else {
            const fileId = docMeta.driveFileId || docMeta.storagePath;
            if (!fileId) throw new Error("No Drive file id");
            arrayBuffer = await downloadDocumentAsArrayBuffer(fileId);
          }
        } catch (err) {
          console.warn("Failed to download document", docMeta, err);
          warnings.push(
            `Could not include: ${docMeta.fileName || docMeta.originalFileName || "unknown"} - download failed`
          );
          processed++;
          continue;
        }

        try {
          const hash = await computeSHA256(arrayBuffer);
          if (seenHashes.has(hash)) {
            warnings.push(
              `Duplicate document skipped: ${docMeta.fileName || docMeta.originalFileName}`
            );
            processed++;
            continue;
          }
          seenHashes.add(hash);
        } catch (e) {
          // continue without hash
        }

        const mime = (docMeta.mimeType || "").toLowerCase();
        const name = (docMeta.fileName || docMeta.originalFileName || "").toLowerCase();

        progress({
          status: STATUS.PROCESSING,
          percent: pct + 2,
          message: `Processing: ${docMeta.fileName || "document"}…`,
        });

        try {
          if (mime.includes("pdf") || name.endsWith(".pdf")) {
            const pagesAdded = await appendPdfPages(mergedPdf, arrayBuffer, PDFDocument);
            totalPagesAdded += pagesAdded;
          } else if (
            mime.includes("jpeg") ||
            mime.includes("jpg") ||
            mime.includes("png") ||
            name.endsWith(".jpg") ||
            name.endsWith(".jpeg") ||
            name.endsWith(".png")
          ) {
            await appendImagePage(mergedPdf, arrayBuffer, mime, name, PDFDocument);
            totalPagesAdded += 1;
          } else {
            try {
              const pagesAdded = await appendPdfPages(mergedPdf, arrayBuffer, PDFDocument);
              totalPagesAdded += pagesAdded;
            } catch {
              await appendImagePage(mergedPdf, arrayBuffer, mime, name, PDFDocument);
              totalPagesAdded += 1;
            }
          }
        } catch (err) {
          console.warn("Failed to process document", docMeta, err);
          warnings.push(
            `Could not include: ${docMeta.fileName || docMeta.originalFileName || "unknown"} - ${err.message || "corrupted or unsupported"}`
          );
        }

        processed++;

        if (totalPagesAdded > APP_CONFIG.largeDossierPageThreshold) {
          progress({
            status: STATUS.MERGING,
            percent: pct,
            message: "Large dossier detected. PDF generation may take several minutes…",
          });
        }
      }
    }

    if (warnings.length > 0) {
      progress({ status: STATUS.FINALIZING, percent: 88, message: "Adding processing warnings…" });
      await addWarningsPage(mergedPdf, warnings);
    }

    progress({ status: STATUS.FINALIZING, percent: 92, message: "Optimizing PDF…" });

    const pdfBytes = await mergedPdf.save({
      useObjectStreams: true,
    });

    progress({ status: STATUS.DONE, percent: 100, message: "PDF Ready" });

    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const fileName = buildFileName(submission);

    return {
      blob,
      fileName,
      pageCount: mergedPdf.getPageCount(),
      documentCount: totalDocs - warnings.filter((w) => w.includes("Duplicate")).length,
      warnings,
      audit,
    };
  } catch (err) {
    console.error("PDF generation failed", err);
    progress({
      status: STATUS.ERROR,
      percent: 0,
      message: err.message || "Unexpected error during PDF generation",
    });
    throw err;
  }
}

async function appendPdfPages(mergedPdf, arrayBuffer, PDFDocument) {
  const sourcePdf = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
  });
  const indices = sourcePdf.getPageIndices();
  const pages = await mergedPdf.copyPages(sourcePdf, indices);
  for (const p of pages) {
    mergedPdf.addPage(p);
  }
  return pages.length;
}

async function appendImagePage(mergedPdf, arrayBuffer, mime, name, PDFDocument) {
  let image;
  const isPng = mime.includes("png") || name.endsWith(".png");
  if (isPng) {
    image = await mergedPdf.embedPng(arrayBuffer);
  } else {
    image = await mergedPdf.embedJpg(arrayBuffer);
  }

  const page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const margin = 36;
  const maxW = A4_WIDTH - margin * 2;
  const maxH = A4_HEIGHT - margin * 2;

  const imgW = image.width;
  const imgH = image.height;
  const scale = Math.min(maxW / imgW, maxH / imgH, 1);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = (A4_WIDTH - drawW) / 2;
  const y = (A4_HEIGHT - drawH) / 2;

  page.drawImage(image, { x, y, width: drawW, height: drawH });
}

async function addWarningsPage(mergedPdf, warnings) {
  const { StandardFonts, rgb } = await import(
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
  );
  const { sanitizePdfText } from "./pdf-summary.js";
  const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
  let page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - 50;

  page.drawText("PROCESSING WARNINGS", {
    x: 50,
    y,
    size: 14,
    font: fontBold,
    color: rgb(0.7, 0.35, 0.05),
  });
  y -= 24;

  for (const w of warnings) {
    if (y < 60) {
      page = mergedPdf.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - 50;
    }
    const text = sanitizePdfText(`- ${w}`).slice(0, 95);
    if (!text) continue;
    page.drawText(text, {
      x: 50,
      y,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    y -= 14;
  }
}

function buildFileName(submission) {
  const name = (submission.applicantName || "Applicant")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  return `${name}_Visa_Application_Dossier_${date}.pdf`;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 2000);
}

/**
 * PDF Summary / checklist page generation using pdf-lib
 * Standard fonts (Helvetica) only support WinAnsi — sanitize all text.
 */

import { formatDisplayDate } from "./file-utils.js";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;

/**
 * Strip / replace characters that Helvetica (WinAnsi) cannot encode.
 * Prevents: WinAnsi cannot encode "..." errors.
 */
export function sanitizePdfText(text) {
  if (text == null) return "";
  return String(text)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // smart double quotes
    .replace(/[\u2013\u2014\u2015]/g, "-") // en/em dashes
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ") // spaces
    .replace(/[⚠△▲]/g, "!")
    .replace(/[✓✔☑]/g, "[OK]")
    .replace(/[✗✘☒×]/g, "[X]")
    .replace(/[•●◦▪▫]/g, "-")
    .replace(/[○◯]/g, "o")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, ""); // drop anything outside Latin-1/WinAnsi-ish
}

export async function addSummaryPages(pdfDoc, submission, audit, options = {}) {
  const { StandardFonts, rgb } = await import(
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
  );

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;

  const drawText = (text, x, yPos, size = 11, bold = false, color = rgb(0.1, 0.1, 0.1)) => {
    const f = bold ? fontBold : font;
    const safe = sanitizePdfText(text);
    if (!safe) return;
    page.drawText(safe, {
      x,
      y: yPos,
      size,
      font: f,
      color,
    });
  };

  const newPageIfNeeded = (needed = 40) => {
    if (y < MARGIN + needed) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
  };

  // Title
  drawText("VISA APPLICATION DOSSIER", MARGIN, y, 18, true, rgb(0.05, 0.2, 0.45));
  y -= 28;

  drawText(
    `Generated: ${formatDisplayDate(new Date().toISOString())}`,
    MARGIN,
    y,
    9,
    false,
    rgb(0.4, 0.4, 0.4)
  );
  y -= 22;

  // Applicant block
  const lines = [
    ["Applicant", submission.applicantName],
    ["Application ID", submission.applicationId],
    ["Email", submission.email],
    ["Phone", submission.phone],
    [
      "Application Level",
      submission.applicationLevel === "masters" ? "Master's" : "Bachelor's",
    ],
    ["Sponsorship", formatSponsorship(submission.sponsorshipType)],
    ["Passport No.", submission.passportNumber || "-"],
    ["University", submission.university || "-"],
    ["Course / Program", submission.course || "-"],
    ["Civil Status", capitalize(submission.civilStatus)],
    ["Nationality", submission.nationality || "-"],
    ["Submitted", formatDisplayDate(submission.submittedAt)],
  ];

  for (const [label, value] of lines) {
    newPageIfNeeded(18);
    drawText(`${label}:`, MARGIN, y, 10, true);
    drawText(String(value ?? "-"), MARGIN + 140, y, 10);
    y -= 16;
  }

  y -= 10;
  newPageIfNeeded(30);

  // Completeness
  const pct = audit.completenessPercentage ?? 0;
  const incomplete = audit.missingCount > 0;
  drawText("Document Completeness", MARGIN, y, 12, true);
  y -= 18;
  drawText(
    `${pct}%  (${audit.uploadedRequiredCount || 0} / ${audit.requiredCount || 0} required documents)`,
    MARGIN,
    y,
    11,
    false,
    incomplete ? rgb(0.7, 0.15, 0.1) : rgb(0.1, 0.5, 0.2)
  );
  y -= 16;

  if (incomplete) {
    drawText("! INCOMPLETE DOSSIER", MARGIN, y, 12, true, rgb(0.75, 0.1, 0.05));
    y -= 18;
  }

  y -= 8;
  newPageIfNeeded(40);
  drawText("DOCUMENT CHECKLIST", MARGIN, y, 13, true, rgb(0.05, 0.2, 0.45));
  y -= 20;

  for (const item of audit.results || []) {
    newPageIfNeeded(16);
    const mark = item.uploaded ? "[OK]" : item.required ? "! MISSING" : "[ ]";
    const color = item.uploaded
      ? rgb(0.1, 0.45, 0.2)
      : item.required
        ? rgb(0.75, 0.1, 0.05)
        : rgb(0.45, 0.45, 0.45);
    const label = item.required ? item.label : `${item.label} (optional)`;
    drawText(`${mark}  ${label}`, MARGIN, y, 9, false, color);
    y -= 14;
  }

  // Missing required list
  if (audit.missingRequired && audit.missingRequired.length > 0) {
    y -= 12;
    newPageIfNeeded(40);
    drawText("! MISSING REQUIRED DOCUMENTS", MARGIN, y, 12, true, rgb(0.75, 0.1, 0.05));
    y -= 18;
    audit.missingRequired.forEach((m, i) => {
      newPageIfNeeded(16);
      drawText(`${i + 1}. ${m.label}`, MARGIN + 10, y, 10, false, rgb(0.6, 0.1, 0.05));
      y -= 15;
    });
  }

  // Processing warnings (corrupted files etc.)
  if (options.warnings && options.warnings.length > 0) {
    y -= 12;
    newPageIfNeeded(40);
    drawText("! PROCESSING WARNINGS", MARGIN, y, 12, true, rgb(0.7, 0.4, 0.05));
    y -= 18;
    for (const w of options.warnings) {
      newPageIfNeeded(16);
      drawText(`- ${w}`, MARGIN + 10, y, 9, false, rgb(0.5, 0.3, 0.05));
      y -= 14;
    }
  }

  // Footer note
  y -= 20;
  newPageIfNeeded(30);
  drawText(
    "This dossier contains the actual uploaded document pages. Missing items are listed above.",
    MARGIN,
    y,
    8,
    false,
    rgb(0.4, 0.4, 0.4)
  );

  return pdfDoc;
}

/**
 * Optional separator page before a document category
 */
export async function addSeparatorPage(pdfDoc, order, label, applicantName) {
  const { StandardFonts, rgb } = await import(
    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"
  );
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const cx = A4_WIDTH / 2;
  const cy = A4_HEIGHT / 2;

  const orderText = sanitizePdfText(`DOCUMENT ${String(order).padStart(2, "0")}`);
  const orderWidth = fontBold.widthOfTextAtSize(orderText, 14);
  page.drawText(orderText, {
    x: cx - orderWidth / 2,
    y: cy + 40,
    size: 14,
    font: fontBold,
    color: rgb(0.3, 0.3, 0.3),
  });

  const safeLabel = sanitizePdfText(label);
  const labelWidth = fontBold.widthOfTextAtSize(safeLabel, 16);
  page.drawText(safeLabel, {
    x: cx - labelWidth / 2,
    y: cy,
    size: 16,
    font: fontBold,
    color: rgb(0.05, 0.2, 0.45),
  });

  const nameText = sanitizePdfText(`Applicant: ${applicantName || ""}`);
  const nameWidth = font.widthOfTextAtSize(nameText, 11);
  page.drawText(nameText, {
    x: cx - nameWidth / 2,
    y: cy - 30,
    size: 11,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
}

function formatSponsorship(type) {
  const map = {
    self: "Self Sponsored",
    parent: "Parent Sponsor",
    other: "Other Sponsor",
  };
  return map[type] || type || "-";
}

function capitalize(s) {
  if (!s) return "-";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

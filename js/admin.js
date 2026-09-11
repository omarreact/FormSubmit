/**
 * Admin dashboard controller
 */

import {
  onAuthStateChanged,
  signInWithToken,
  signOut,
  isAdminAuthenticated,
} from "./auth.js";
import {
  listSubmissions,
  getSubmission,
  getSubmissionDocuments,
  recordPdfGeneration,
  isRemoteConfigured,
} from "./submissions.js";
import { auditDocuments } from "./document-audit.js";
import { generateApplicantPdf, downloadBlob } from "./pdf-generator.js";
import { createProgressController, STATUS } from "./pdf-progress.js";
import { formatDisplayDate, escapeHtml } from "./file-utils.js";

let allSubmissions = [];
let progressCtrl = null;

function showLogin() {
  document.getElementById("loginPanel")?.classList.remove("d-none");
  document.getElementById("dashboardPanel")?.classList.add("d-none");
}

function showDashboard(user) {
  document.getElementById("loginPanel")?.classList.add("d-none");
  document.getElementById("dashboardPanel")?.classList.remove("d-none");
  const userEl = document.getElementById("adminUserEmail");
  if (userEl) userEl.textContent = user.email || "Admin";
}

async function handleLogin(e) {
  e.preventDefault();
  const token = document.getElementById("loginToken")?.value?.trim()
    || document.getElementById("loginPassword")?.value?.trim();
  const errEl = document.getElementById("loginError");
  if (errEl) {
    errEl.classList.add("d-none");
    errEl.textContent = "";
  }
  try {
    signInWithToken(token);
    showDashboard({ email: "Admin" });
    await loadDashboard();
  } catch (err) {
    console.error(err);
    if (errEl) {
      errEl.textContent = err.message || "Login failed";
      errEl.classList.remove("d-none");
    }
  }
}

async function handleLogout() {
  await signOut();
  showLogin();
}

function completenessBadge(pct) {
  let cls = "badge-completeness-low";
  if (pct >= 90) cls = "badge-completeness-high";
  else if (pct >= 60) cls = "badge-completeness-mid";
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function renderMetrics(subs) {
  const total = subs.length;
  const complete = subs.filter(
    (s) => (s.documentAudit?.completenessPercentage ?? 0) >= 100
  ).length;
  const missing = total - complete;
  setText("metricTotal", total);
  setText("metricComplete", complete);
  setText("metricMissing", missing);
  setText("metricPdfs", "—");
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

function getFilters() {
  return {
    search: (document.getElementById("filterSearch")?.value || "").trim().toLowerCase(),
    level: document.getElementById("filterLevel")?.value || "",
    completeness: document.getElementById("filterCompleteness")?.value || "",
  };
}

function filterSubmissions(subs) {
  const f = getFilters();
  return subs.filter((s) => {
    if (f.level && s.applicationLevel !== f.level) return false;
    const pct = s.documentAudit?.completenessPercentage ?? 0;
    if (f.completeness === "complete" && pct < 100) return false;
    if (f.completeness === "missing" && pct >= 100) return false;
    if (f.search) {
      const hay = [s.applicantName, s.email, s.phone, s.applicationId, s.passportNumber]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

function renderTable(subs) {
  const tbody = document.getElementById("applicantsTableBody");
  if (!tbody) return;
  const filtered = filterSubmissions(subs);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No applicants found</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((s) => {
    const pct = s.documentAudit?.completenessPercentage ?? 0;
    return `
      <tr>
        <td>
          <div class="fw-medium">${escapeHtml(s.applicantName || "—")}</div>
          <div class="small text-muted">${escapeHtml(s.email || "")}</div>
        </td>
        <td><code>${escapeHtml(s.applicationId || s.id)}</code></td>
        <td>${s.applicationLevel === "masters" ? "Master's" : "Bachelor's"}</td>
        <td>${formatDisplayDate(s.submittedAt)}</td>
        <td>${completenessBadge(pct)}</td>
        <td><span class="badge bg-secondary">${escapeHtml(s.status || "submitted")}</span></td>
      </tr>`;
  }).join("");
}

function populateApplicantDropdown(subs) {
  const sel = document.getElementById("applicantSelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">Select Applicant…</option>`;
  for (const s of subs) {
    const label = `${s.applicantName || "Unknown"} — ${formatDisplayDate(s.submittedAt)} (${s.applicationId || s.id})`;
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}

async function onApplicantSelected() {
  const id = document.getElementById("applicantSelect")?.value;
  const detail = document.getElementById("applicantDetail");
  const checkList = document.getElementById("documentCheckList");
  const downloadBtn = document.getElementById("downloadPdfBtn");

  if (!id) {
    detail?.classList.add("d-none");
    if (downloadBtn) downloadBtn.disabled = true;
    return;
  }

  const sub = allSubmissions.find((s) => s.id === id) || (await getSubmission(id));
  if (!sub) return;

  const docs = await getSubmissionDocuments(id);
  const audit = auditDocuments(sub, docs);

  setText("detailName", sub.applicantName || "—");
  setText("detailEmail", sub.email || "—");
  setText("detailPhone", sub.phone || "—");
  setText("detailAppId", sub.applicationId || sub.id);
  setText("detailLevel", sub.applicationLevel === "masters" ? "Master's" : "Bachelor's");
  setText("detailSubmitted", formatDisplayDate(sub.submittedAt));
  setText("detailCompleteness", `${audit.completenessPercentage}%`);

  if (checkList) {
    checkList.innerHTML = audit.results.map((r) => {
      const cls = r.uploaded ? "item-ok" : r.required ? "item-missing" : "text-muted";
      const mark = r.uploaded ? "✓" : r.required ? "⚠ MISSING" : "○";
      return `<div class="${cls}">${mark} ${escapeHtml(r.label)}</div>`;
    }).join("");
  }

  const warn = document.getElementById("missingWarning");
  if (warn) {
    if (audit.missingCount > 0) {
      warn.classList.remove("d-none");
      warn.innerHTML = `<strong>⚠ ${audit.missingCount} required document(s) missing</strong>
        <div class="small mt-1">${audit.missingRequired.map((m) => escapeHtml(m.label)).join(", ")}</div>
        <div class="small text-muted mt-1">You can still generate the dossier.</div>`;
    } else {
      warn.classList.add("d-none");
      warn.innerHTML = "";
    }
  }

  detail?.classList.remove("d-none");
  if (downloadBtn) {
    downloadBtn.disabled = false;
    downloadBtn.dataset.submissionId = id;
  }
}

async function handleDownloadPdf() {
  const btn = document.getElementById("downloadPdfBtn");
  const submissionId = btn?.dataset.submissionId;
  if (!submissionId) return;

  const modalEl = document.getElementById("pdfProgressModal");
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {
    backdrop: "static",
    keyboard: false,
  });

  if (!progressCtrl) progressCtrl = createProgressController(modalEl);
  progressCtrl.reset();
  modal.show();
  btn.disabled = true;

  try {
    const sub = await getSubmission(submissionId);
    const docs = await getSubmissionDocuments(submissionId);

    const result = await generateApplicantPdf(sub, docs, (p) => {
      progressCtrl.update(p);
    });

    try {
      const { getCurrentUser } = await import("./auth.js");
      const user = await getCurrentUser();
      await recordPdfGeneration(submissionId, {
        generatedBy: user?.email || null,
        documentCount: result.documentCount,
        pageCount: result.pageCount,
        missingDocumentsAtGeneration: result.audit?.missingRequired?.map((m) => m.key) || [],
        fileName: result.fileName,
        warnings: result.warnings,
      });
    } catch (e) {
      console.warn("Could not record PDF history", e);
    }

    downloadBlob(result.blob, result.fileName);

    setTimeout(() => {
      modal.hide();
      btn.disabled = false;
    }, 1200);
  } catch (err) {
    console.error(err);
    progressCtrl.update({
      status: STATUS.ERROR,
      percent: 0,
      message: err.message || "Failed to generate PDF",
    });
    btn.disabled = false;
  }
}

function exportCsv() {
  const rows = filterSubmissions(allSubmissions);
  const headers = [
    "Application ID", "Applicant", "Email", "Phone", "Level", "Submitted",
    "Document Count", "Missing Count", "Completeness", "Status",
  ];
  const lines = [headers.join(",")];
  for (const s of rows) {
    const audit = s.documentAudit || {};
    const vals = [
      s.applicationId || s.id, s.applicantName, s.email, s.phone,
      s.applicationLevel, s.submittedAt,
      audit.totalUploadedFiles ?? "", audit.missingCount ?? "",
      audit.completenessPercentage ?? "", s.status,
    ].map((v) => {
      const str = v == null ? "" : String(v);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(vals.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `visa_submissions_${new Date().toISOString().slice(0, 10)}.csv`);
}

async function loadDashboard() {
  try {
    allSubmissions = await listSubmissions();
  } catch (err) {
    console.error(err);
    allSubmissions = [];
    const tbody = document.getElementById("applicantsTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">
        Failed to load submissions.
      </td></tr>`;
    }
  }
  renderMetrics(allSubmissions);
  renderTable(allSubmissions);
  populateApplicantDropdown(allSubmissions);
}

export function initAdmin() {
  const ban = document.getElementById("localModeBannerAdmin");
  if (ban && !isRemoteConfigured()) ban.classList.remove("d-none");
  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("filterSearch")?.addEventListener("input", () => renderTable(allSubmissions));
  document.getElementById("filterLevel")?.addEventListener("change", () => renderTable(allSubmissions));
  document.getElementById("filterCompleteness")?.addEventListener("change", () => renderTable(allSubmissions));
  document.getElementById("applicantSelect")?.addEventListener("change", onApplicantSelected);
  document.getElementById("downloadPdfBtn")?.addEventListener("click", handleDownloadPdf);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exportCsv);
  document.getElementById("refreshBtn")?.addEventListener("click", loadDashboard);

  onAuthStateChanged(async (user) => {
    if (!user || !isAdminAuthenticated()) {
      showLogin();
      return;
    }
    showDashboard(user);
    await loadDashboard();
  });
}

if (document.getElementById("loginForm") || document.getElementById("dashboardPanel")) {
  document.addEventListener("DOMContentLoaded", () => {
    initAdmin();
  });
}

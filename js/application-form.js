/**
 * Public visa application form controller
 */

import { getRulesBySection, isDocumentRequired, DOCUMENT_RULES } from "./document-rules.js";
import { createUploadField, collectAllUploads } from "./uploads.js";
import { auditDocuments } from "./document-audit.js";
import { createSubmission } from "./submissions.js";
import { escapeHtml } from "./file-utils.js";
import { APP_CONFIG } from "./config.js";

const uploadControllers = new Map();

function getApplicantSnapshot() {
  return {
    applicantName: document.getElementById("applicantName")?.value?.trim() || "",
    email: document.getElementById("email")?.value?.trim() || "",
    phone: document.getElementById("phone")?.value?.trim() || "",
    applicationLevel: document.getElementById("applicationLevel")?.value || "bachelors",
    sponsorshipType: document.getElementById("sponsorshipType")?.value || "self",
    passportNumber: document.getElementById("passportNumber")?.value?.trim() || "",
    university: document.getElementById("university")?.value?.trim() || "",
    course: document.getElementById("course")?.value?.trim() || "",
    destinationCountry: document.getElementById("destinationCountry")?.value?.trim() || "",
    civilStatus: document.getElementById("civilStatus")?.value || "single",
    isMinor: document.getElementById("isMinor")?.checked === true,
    nationality: document.getElementById("nationality")?.value?.trim() || "Bangladeshi",
    notes: document.getElementById("notes")?.value?.trim() || "",
  };
}

function buildUploadFields() {
  const container = document.getElementById("documentSections");
  if (!container) return;

  const applicant = getApplicantSnapshot();
  const sections = getRulesBySection(applicant);

  container.innerHTML = "";
  uploadControllers.clear();

  const accordionId = "docsAccordion";
  const accordion = document.createElement("div");
  accordion.className = "accordion form-section-accordion";
  accordion.id = accordionId;

  sections.forEach((section, sIdx) => {
    const collapseId = `collapse-sec-${sIdx}`;
    const item = document.createElement("div");
    item.className = "accordion-item mb-2";
    item.innerHTML = `
      <h2 class="accordion-header">
        <button class="accordion-button ${sIdx === 0 ? "" : "collapsed"}" type="button"
          data-bs-toggle="collapse" data-bs-target="#${collapseId}"
          aria-expanded="${sIdx === 0 ? "true" : "false"}" aria-controls="${collapseId}">
          ${escapeHtml(section.name)}
        </button>
      </h2>
      <div id="${collapseId}" class="accordion-collapse collapse ${sIdx === 0 ? "show" : ""}"
        data-bs-parent="#${accordionId}">
        <div class="accordion-body" data-section-body></div>
      </div>
    `;
    const body = item.querySelector("[data-section-body]");

    for (const rule of section.rules) {
      const required = isDocumentRequired(rule, applicant);
      const fieldId = `upload-${rule.key}`;
      const wrap = document.createElement("div");
      wrap.className = "mb-3 upload-field";
      wrap.dataset.category = rule.key;
      wrap.innerHTML = `
        <div class="field-label-row">
          <label class="form-label mb-0" for="${fieldId}">
            ${escapeHtml(rule.label)}
            ${required ? '<span class="required-mark" aria-hidden="true">*</span>' : ""}
          </label>
          <span class="badge ${required ? "bg-danger" : "bg-secondary"}" data-req-badge>
            ${required ? "Required" : rule.notRequiredMessage || "Optional"}
          </span>
        </div>
        <input type="file" class="form-control form-control-sm" id="${fieldId}"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          ${rule.multiple ? "multiple" : ""}
          aria-describedby="${fieldId}-help ${fieldId}-error">
        <div class="d-flex flex-wrap gap-2 align-items-center mt-2">
          <label class="form-label small mb-0 text-muted" for="${fieldId}-date">Document date (optional)</label>
          <input type="date" class="form-control form-control-sm w-auto" id="${fieldId}-date" data-document-date>
        </div>
        <div class="form-text" id="${fieldId}-help">PDF, JPG or PNG · max ${APP_CONFIG.maxFileSizeMB} MB each</div>
        <div class="text-danger small mt-1" id="${fieldId}-error" data-upload-error role="alert"></div>
        <div class="mt-2" data-upload-list></div>
      `;
      body.appendChild(wrap);

      const ctrl = createUploadField({
        categoryKey: rule.key,
        multiple: !!rule.multiple,
        container: wrap,
      });
      uploadControllers.set(rule.key, ctrl);
    }

    accordion.appendChild(item);
  });

  container.appendChild(accordion);
}

function validateApplicantFields() {
  const errors = [];
  const name = document.getElementById("applicantName")?.value?.trim();
  const email = document.getElementById("email")?.value?.trim();
  const phone = document.getElementById("phone")?.value?.trim();
  const level = document.getElementById("applicationLevel")?.value;
  const sponsorship = document.getElementById("sponsorshipType")?.value;

  if (!name) errors.push("Applicant Full Name is required.");
  if (!email) errors.push("Email is required.");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email format is invalid.");
  if (!phone) errors.push("Mobile Number is required.");
  if (!level) errors.push("Application Level is required.");
  if (!sponsorship) errors.push("Sponsorship Type is required.");

  return errors;
}

function showValidationSummary(errors) {
  const el = document.getElementById("validationSummary");
  if (!el) return;
  if (!errors.length) {
    el.classList.add("d-none");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("d-none");
  el.innerHTML = `
    <strong>Please fix the following:</strong>
    <ul class="mb-0 mt-1">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
  `;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showMissingConfirm(audit) {
  return new Promise((resolve) => {
    const modalEl = document.getElementById("missingDocsModal");
    const listEl = document.getElementById("missingDocsList");
    const countEl = document.getElementById("missingDocsCount");
    if (!modalEl || !listEl) {
      resolve(true);
      return;
    }
    countEl.textContent = String(audit.missingCount);
    listEl.innerHTML = audit.missingRequired
      .map((m) => `<li>${escapeHtml(m.label)}</li>`)
      .join("");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const confirmBtn = document.getElementById("confirmSubmitAnyway");
    const cancelBtn = document.getElementById("cancelSubmitMissing");

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    function cleanup() {
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.hide();
    }
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.show();
  });
}

async function handleSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById("submitBtn");
  const statusEl = document.getElementById("submitStatus");

  const fieldErrors = validateApplicantFields();
  showValidationSummary(fieldErrors);
  if (fieldErrors.length) return;

  const applicant = getApplicantSnapshot();
  const filesByCategory = collectAllUploads(uploadControllers);

  const uploadedMeta = [];
  for (const g of filesByCategory) {
    for (const f of g.files) {
      uploadedMeta.push({
        categoryKey: g.categoryKey,
        fileName: f.name,
        documentDate: g.documentDate,
      });
    }
  }
  const audit = auditDocuments(applicant, uploadedMeta);

  if (audit.missingCount > 0) {
    const proceed = await showMissingConfirm(audit);
    if (!proceed) return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Submitting…`;
  if (statusEl) {
    statusEl.classList.remove("d-none", "alert-success", "alert-danger");
    statusEl.classList.add("alert-info");
    statusEl.textContent = "Uploading documents and saving application…";
  }

  try {
    const result = await createSubmission(applicant, filesByCategory);

    document.getElementById("formMain")?.classList.add("d-none");
    const success = document.getElementById("successPanel");
    if (success) {
      success.classList.remove("d-none");
      document.getElementById("successAppId").textContent = result.applicationId;
      document.getElementById("successCompleteness").textContent =
        `${result.audit.completenessPercentage}%`;
      if (result.audit.missingCount > 0) {
        document.getElementById("successMissingNote").classList.remove("d-none");
        document.getElementById("successMissingNote").textContent =
          `${result.audit.missingCount} required document(s) were still missing at submission. You may contact the office to add them later.`;
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error(err);
    if (statusEl) {
      statusEl.classList.remove("alert-info");
      statusEl.classList.add("alert-danger");
      statusEl.textContent =
        err.message?.includes("Apps Script") || err.message?.includes("configured")
          ? "Submission failed. Please ensure Google Apps Script is configured correctly (see README)."
          : `Submission failed: ${err.message || "Unknown error"}`;
    }
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="bi bi-send me-1"></i> Submit Application`;
  }
}

function bindConditionalRebuild() {
  const triggers = [
    "applicationLevel",
    "sponsorshipType",
    "civilStatus",
    "isMinor",
    "nationality",
  ];
  for (const id of triggers) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", () => {
      buildUploadFields();
    });
  }
}

export function initApplicationForm() {
  buildUploadFields();
  bindConditionalRebuild();
  const form = document.getElementById("visaApplicationForm");
  if (form) form.addEventListener("submit", handleSubmit);
}

if (document.getElementById("visaApplicationForm")) {
  document.addEventListener("DOMContentLoaded", () => {
    initApplicationForm();
  });
}

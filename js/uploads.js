/**
 * Reusable upload component — selection, validation, scan results, removal.
 */

import { validateFile, formatFileSize, escapeHtml } from "./file-utils.js";
import { scanFile } from "./file-scan.js";

export function createUploadField({
  categoryKey,
  multiple = false,
  container,
  onChange,
  enableScan = false,
}) {
  const state = {
    files: [],
  };

  const listEl = container.querySelector("[data-upload-list]");
  const inputEl = container.querySelector('input[type="file"]');
  const dateEl = container.querySelector("[data-document-date]");
  const errorEl = container.querySelector("[data-upload-error]");

  function statusBadge(scan, scanning) {
    if (scanning) return `<span class="badge bg-info text-dark">Scanning…</span>`;
    if (!scan) return "";
    if (scan.status === "ok") return `<span class="badge bg-success">Scan OK</span>`;
    if (scan.status === "warning") return `<span class="badge bg-warning text-dark">Scan warning</span>`;
    return `<span class="badge bg-danger">Scan failed</span>`;
  }

  function render() {
    if (!listEl) return;
    if (state.files.length === 0) {
      listEl.innerHTML = `<div class="text-muted small">No files selected</div>`;
      return;
    }
    listEl.innerHTML =
      state.files
        .map((item, idx) => {
          const scan = item.scan;
          const notesHtml =
            scan && scan.notes && scan.notes.length
              ? `<ul class="mb-0 mt-1 ps-3" style="font-size:0.75rem">${scan.notes
                  .map((n) => `<li>${escapeHtml(n)}</li>`)
                  .join("")}</ul>`
              : "";
          const summary = item.scanning
            ? "Reading file…"
            : scan
              ? escapeHtml(scan.summary)
              : "";
          return `
      <div class="upload-file-item mb-2 p-2 border rounded bg-light" data-idx="${idx}">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-file-earmark-check text-success"></i>
          <div class="flex-grow-1 overflow-hidden">
            <div class="text-truncate fw-medium small">${escapeHtml(item.file.name)}</div>
            <div class="text-muted" style="font-size:0.75rem">${formatFileSize(item.file.size)} · ${escapeHtml(item.file.type || "unknown")}</div>
          </div>
          ${statusBadge(scan, item.scanning)}
          <button type="button" class="btn btn-sm btn-outline-danger" data-remove="${idx}" aria-label="Remove file">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        ${
          enableScan
            ? `<div class="mt-1 small ${scan?.status === "error" ? "text-danger" : "text-muted"}" data-scan-result>
            ${summary}${notesHtml}
            ${
              scan && scan.status === "ok"
                ? `<div class="text-success mt-1" style="font-size:0.75rem"><i class="bi bi-check2-circle"></i> Ready to include in the applicant PDF dossier</div>`
                : ""
            }
          </div>`
            : ""
        }
      </div>`;
        })
        .join("") +
      (state.files.length > 1
        ? `<div class="small text-muted mt-1">${state.files.length} files uploaded</div>`
        : "");
  }

  function emitChange() {
    if (typeof onChange === "function") onChange(categoryKey, state.files);
  }

  async function runScan(item) {
    if (!enableScan) return;
    item.scanning = true;
    item.scan = null;
    render();
    try {
      item.scan = await scanFile(item.file);
    } catch (e) {
      item.scan = {
        status: "error",
        summary: "Scan failed",
        fileType: "unknown",
        sizeLabel: formatFileSize(item.file.size),
        notes: [e.message || "Unknown error"],
      };
    }
    item.scanning = false;
    render();
    emitChange();
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (errorEl) errorEl.textContent = "";

    for (const file of incoming) {
      const v = validateFile(file);
      if (!v.valid) {
        if (errorEl) errorEl.textContent = v.error;
        continue;
      }
      if (!multiple) state.files = [];
      const item = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        documentDate: dateEl ? dateEl.value || null : null,
        scanning: false,
        scan: null,
      };
      state.files.push(item);
      if (enableScan) runScan(item);
    }
    render();
    emitChange();
  }

  if (inputEl) {
    inputEl.addEventListener("change", (e) => {
      addFiles(e.target.files);
      inputEl.value = "";
    });
  }

  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      const idx = parseInt(btn.getAttribute("data-remove"), 10);
      state.files.splice(idx, 1);
      render();
      emitChange();
    });
  }

  if (dateEl) {
    dateEl.addEventListener("change", () => {
      const d = dateEl.value || null;
      state.files.forEach((f) => {
        f.documentDate = d;
      });
      emitChange();
    });
  }

  render();

  return {
    getFiles: () =>
      state.files.map((f) => ({
        file: f.file,
        documentDate: f.documentDate,
        scan: f.scan || null,
      })),
    getRaw: () => state.files,
    clear: () => {
      state.files = [];
      render();
      emitChange();
    },
    setRequiredVisual: (required, notRequiredMessage) => {
      const badge = container.querySelector("[data-req-badge]");
      if (badge) {
        if (required) {
          badge.className = "badge bg-danger";
          badge.textContent = "Required";
        } else if (notRequiredMessage) {
          badge.className = "badge bg-secondary";
          badge.textContent = notRequiredMessage;
        } else {
          badge.className = "badge bg-secondary";
          badge.textContent = "Optional";
        }
      }
    },
  };
}

export function collectAllUploads(controllers) {
  const result = [];
  const entries =
    controllers instanceof Map
      ? controllers.entries()
      : Object.entries(controllers);

  for (const [key, ctrl] of entries) {
    const items = ctrl.getFiles();
    if (items.length === 0) continue;
    const byDate = {};
    for (const item of items) {
      const d = item.documentDate || "_none";
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(item.file);
    }
    for (const [d, files] of Object.entries(byDate)) {
      result.push({
        categoryKey: key,
        files,
        documentDate: d === "_none" ? null : d,
      });
    }
  }
  return result;
}

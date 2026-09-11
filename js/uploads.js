/**
 * Reusable upload component logic
 * Manages file selection, validation, preview list, and removal.
 */

import { validateFile, formatFileSize, escapeHtml } from "./file-utils.js";

/**
 * Create an upload field controller for a single category.
 * @param {Object} options
 * @param {string} options.categoryKey
 * @param {boolean} options.multiple
 * @param {HTMLElement} options.container - element that holds the file list + input
 * @param {Function} [options.onChange]
 */
export function createUploadField({ categoryKey, multiple = false, container, onChange }) {
  const state = {
    files: [], // { id, file, documentDate }
  };

  const listEl = container.querySelector("[data-upload-list]");
  const inputEl = container.querySelector('input[type="file"]');
  const dateEl = container.querySelector("[data-document-date]");
  const errorEl = container.querySelector("[data-upload-error]");

  function render() {
    if (!listEl) return;
    if (state.files.length === 0) {
      listEl.innerHTML = `<div class="text-muted small">No files selected</div>`;
      return;
    }
    listEl.innerHTML = state.files
      .map(
        (item, idx) => `
      <div class="upload-file-item d-flex align-items-center gap-2 mb-1 p-2 border rounded bg-light" data-idx="${idx}">
        <i class="bi bi-file-earmark-check text-success"></i>
        <div class="flex-grow-1 overflow-hidden">
          <div class="text-truncate fw-medium small">${escapeHtml(item.file.name)}</div>
          <div class="text-muted" style="font-size:0.75rem">${formatFileSize(item.file.size)} · ${escapeHtml(item.file.type || "unknown")}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" data-remove="${idx}" aria-label="Remove file">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>`
      )
      .join("") +
      (state.files.length > 1
        ? `<div class="small text-muted mt-1">${state.files.length} files uploaded</div>`
        : "");
  }

  function emitChange() {
    if (typeof onChange === "function") {
      onChange(categoryKey, state.files);
    }
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
      if (!multiple) {
        state.files = [];
      }
      state.files.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        documentDate: dateEl ? dateEl.value || null : null,
      });
    }
    render();
    emitChange();
  }

  if (inputEl) {
    inputEl.addEventListener("change", (e) => {
      addFiles(e.target.files);
      // reset so same file can be re-selected after remove
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
    getFiles: () => state.files.map((f) => ({ file: f.file, documentDate: f.documentDate })),
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

/**
 * Collect all files from a map of upload controllers
 * @param {Map|Object} controllers - key -> controller
 * @returns {Array<{categoryKey, files: File[], documentDate}>}
 */
export function collectAllUploads(controllers) {
  const result = [];
  const entries =
    controllers instanceof Map
      ? controllers.entries()
      : Object.entries(controllers);

  for (const [key, ctrl] of entries) {
    const items = ctrl.getFiles();
    if (items.length === 0) continue;
    // group by documentDate if mixed (usually same)
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

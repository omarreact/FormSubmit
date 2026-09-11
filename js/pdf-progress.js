/**
 * PDF generation progress UI helper
 */

const STATUS = {
  IDLE: "IDLE",
  AUDITING: "AUDITING",
  FETCHING: "FETCHING",
  PROCESSING: "PROCESSING",
  MERGING: "MERGING",
  FINALIZING: "FINALIZING",
  DONE: "DONE",
  ERROR: "ERROR",
};

export { STATUS };

/**
 * Bind progress UI elements inside a Bootstrap modal
 */
export function createProgressController(modalEl) {
  const bar = modalEl.querySelector("[data-progress-bar]");
  const percentEl = modalEl.querySelector("[data-progress-percent]");
  const messageEl = modalEl.querySelector("[data-progress-message]");
  const titleEl = modalEl.querySelector("[data-progress-title]");
  const statusEl = modalEl.querySelector("[data-progress-status]");

  let currentPercent = 0;

  function update({ status, percent, message }) {
    if (typeof percent === "number") {
      currentPercent = Math.max(0, Math.min(100, percent));
    }
    if (bar) {
      bar.style.width = `${currentPercent}%`;
      bar.setAttribute("aria-valuenow", String(currentPercent));
      bar.classList.toggle("bg-success", status === STATUS.DONE);
      bar.classList.toggle("bg-danger", status === STATUS.ERROR);
      bar.classList.toggle("progress-bar-striped", status !== STATUS.DONE && status !== STATUS.ERROR);
      bar.classList.toggle("progress-bar-animated", status !== STATUS.DONE && status !== STATUS.ERROR);
    }
    if (percentEl) percentEl.textContent = `${Math.round(currentPercent)}%`;
    if (messageEl && message) messageEl.textContent = message;
    if (statusEl && status) statusEl.textContent = status;
    if (titleEl) {
      if (status === STATUS.DONE) titleEl.textContent = "PDF Ready";
      else if (status === STATUS.ERROR) titleEl.textContent = "PDF Generation Failed";
      else titleEl.textContent = "Building Applicant PDF";
    }
  }

  function reset() {
    currentPercent = 0;
    update({ status: STATUS.IDLE, percent: 0, message: "Preparing…" });
  }

  return { update, reset, STATUS };
}

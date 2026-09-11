/**
 * Submissions layer — Google Sheets + Drive (via Apps Script)
 * Keeps the same function names used by application-form.js and admin.js
 */

export {
  createSubmission,
  listSubmissions,
  getSubmission,
  getSubmissionDocuments,
  downloadDocumentAsArrayBuffer,
  addDocumentsToSubmission,
  recordPdfGeneration,
} from "./sheets-api.js";

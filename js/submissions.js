/**
 * Submissions layer — Google Sheets + Drive (via Apps Script)
 * or local IndexedDB when Apps Script is not configured.
 */

export {
  createSubmission,
  listSubmissions,
  getSubmission,
  getSubmissionDocuments,
  downloadDocumentAsArrayBuffer,
  addDocumentsToSubmission,
  recordPdfGeneration,
  isRemoteConfigured,
} from "./sheets-api.js";

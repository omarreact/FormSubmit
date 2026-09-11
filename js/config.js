/**
 * Application Configuration — Google Sheets + Drive via Apps Script
 *
 * Setup:
 * 1. Create a Google Sheet and a Drive folder for submissions.
 * 2. Deploy apps-script/Code.gs as a Web App (Execute as: Me, Access: Anyone).
 * 3. Paste the Web App URL and matching ADMIN_TOKEN below.
 */

export const APP_CONFIG = {
  appName: "Visa Application Document Submission 2026",
  year: 2026,
  applicationIdPrefix: "VISA-2026-",
  maxFileSizeMB: 20,
  maxFileSizeBytes: 20 * 1024 * 1024,
  acceptedFileTypes: ["application/pdf", "image/jpeg", "image/jpg", "image/png"],
  acceptedExtensions: [".pdf", ".jpg", ".jpeg", ".png"],
  pdfConcurrency: 2,
  largeDossierPageThreshold: 80,
};

/**
 * Google Apps Script Web App configuration
 */
export const GOOGLE_CONFIG = {
  // Example: https://script.google.com/macros/s/AKfycbx.../exec
  webAppUrl: "https://script.google.com/macros/s/AKfycbybJDhmLXXywhMurEjgeoZCeX8scB-JxMrtkwEKqmbSVjVmhJlOVV9umhbkH4QjDqgXtQ/exec",

  /**
   * Shared secret for admin list/download endpoints.
   * Must match ADMIN_TOKEN in apps-script/Code.gs
   */
  adminToken: "AKfycbybJDhmLXXywhMurEjgeoZCeX8scB-JxMrtkwEKqmbSVjVmhJlOVV9umhbkH4QjDqgXtQ",
};

export const ADMIN_SESSION_KEY = "visa_admin_authenticated";

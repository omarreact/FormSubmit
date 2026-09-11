/**
 * Local / offline backend (IndexedDB)
 * Used when Google Apps Script is not configured so the full workflow
 * still works: submit → list → download dossier PDF.
 */

import { APP_CONFIG } from "./config.js";
import { generateId, sanitizeFileName } from "./file-utils.js";
import { DOCUMENT_RULES } from "./document-rules.js";
import { auditDocuments } from "./document-audit.js";

const DB_NAME = "visa_formsubmit_v1";
const DB_VERSION = 1;
const STORE_SUBS = "submissions";
const STORE_DOCS = "documents";
const STORE_FILES = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SUBS)) {
        db.createObjectStore(STORE_SUBS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const s = db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        s.createIndex("submissionId", "submissionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function put(storeName, value) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await txDone(tx);
}

async function get(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getDocsBySubmission(submissionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, "readonly");
    const idx = tx.objectStore(STORE_DOCS).index("submissionId");
    const req = idx.getAll(submissionId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

function nextLocalApplicationId() {
  const key = "visa_local_app_counter";
  const n = (Number(localStorage.getItem(key)) || 0) + 1;
  localStorage.setItem(key, String(n));
  return `${APP_CONFIG.applicationIdPrefix}${String(n).padStart(6, "0")}`;
}

export async function createSubmission(applicantData, filesByCategory) {
  const uploadedMeta = [];
  for (const group of filesByCategory) {
    for (const file of group.files) {
      uploadedMeta.push({
        categoryKey: group.categoryKey,
        fileName: file.name,
        documentDate: group.documentDate || null,
      });
    }
  }
  const audit = auditDocuments(applicantData, uploadedMeta);
  const submissionId = generateId("sub");
  const applicationId = nextLocalApplicationId();
  const now = new Date().toISOString();

  const submission = {
    id: submissionId,
    submissionId,
    applicationId,
    ...applicantData,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    driveFolderId: "local",
    documentAudit: {
      requiredCount: audit.requiredCount,
      uploadedCount: audit.uploadedRequiredCount,
      missingCount: audit.missingCount,
      completenessPercentage: audit.completenessPercentage,
      totalUploadedFiles: audit.totalUploadedFiles,
    },
    requiredCount: audit.requiredCount,
    uploadedRequiredCount: audit.uploadedRequiredCount,
    missingCount: audit.missingCount,
    completenessPercentage: audit.completenessPercentage,
    totalUploadedFiles: audit.totalUploadedFiles,
  };

  await put(STORE_SUBS, submission);

  for (const group of filesByCategory) {
    const rule = DOCUMENT_RULES[group.categoryKey];
    for (const file of group.files) {
      if (file.size > APP_CONFIG.maxFileSizeBytes) {
        throw new Error(
          `File ${file.name} exceeds ${APP_CONFIG.maxFileSizeMB} MB limit`
        );
      }
      const documentId = generateId("doc");
      const buffer = await fileToArrayBuffer(file);
      const safeName = sanitizeFileName(file.name);

      await put(STORE_FILES, {
        id: documentId,
        arrayBuffer: buffer,
        mimeType: file.type || "application/octet-stream",
        fileName: safeName,
      });

      await put(STORE_DOCS, {
        id: documentId,
        documentId,
        submissionId,
        applicationId,
        categoryKey: group.categoryKey,
        categoryName: rule?.label || group.categoryKey,
        checklistOrder: rule?.order || 999,
        fileName: safeName,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        documentDate: group.documentDate || null,
        uploadedAt: now,
        driveFileId: documentId,
        storagePath: documentId,
      });
    }
  }

  return { submissionId, applicationId, audit, submission };
}

export async function listSubmissions() {
  const list = await getAll(STORE_SUBS);
  list.sort((a, b) =>
    String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))
  );
  return list;
}

export async function getSubmission(submissionId) {
  return (await get(STORE_SUBS, submissionId)) || null;
}

export async function getSubmissionDocuments(submissionId) {
  return getDocsBySubmission(submissionId);
}

export async function downloadDocumentAsArrayBuffer(driveFileId) {
  const rec = await get(STORE_FILES, driveFileId);
  if (!rec || !rec.arrayBuffer) {
    throw new Error("Local file not found: " + driveFileId);
  }
  return rec.arrayBuffer;
}

export async function addDocumentsToSubmission() {
  throw new Error("Add documents not implemented in local mode");
}

export async function recordPdfGeneration() {}

/**
 * Client for Google Apps Script Web App (Sheets + Drive backend)
 */

import { GOOGLE_CONFIG, APP_CONFIG } from "./config.js";
import { generateId, sanitizeFileName } from "./file-utils.js";
import { DOCUMENT_RULES } from "./document-rules.js";
import { auditDocuments } from "./document-audit.js";

function assertConfigured() {
  if (
    !GOOGLE_CONFIG.webAppUrl ||
    GOOGLE_CONFIG.webAppUrl.includes("YOUR_APPS_SCRIPT")
  ) {
    throw new Error(
      "Google Apps Script Web App URL is not configured. Update js/config.js (see README)."
    );
  }
}

async function apiPost(payload) {
  assertConfigured();
  const res = await fetch(GOOGLE_CONFIG.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Invalid response from Apps Script. Check deployment (Execute as: Me, Access: Anyone) and script logs."
    );
  }
  if (!data.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = String(result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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

  const created = await apiPost({
    action: "submit",
    applicant: applicantData,
    audit: {
      requiredCount: audit.requiredCount,
      uploadedRequiredCount: audit.uploadedRequiredCount,
      missingCount: audit.missingCount,
      completenessPercentage: audit.completenessPercentage,
      totalUploadedFiles: audit.totalUploadedFiles,
    },
  });

  const { submissionId, applicationId, driveFolderId } = created;

  let uploaded = 0;
  for (const group of filesByCategory) {
    const rule = DOCUMENT_RULES[group.categoryKey];
    for (const file of group.files) {
      if (file.size > APP_CONFIG.maxFileSizeBytes) {
        throw new Error(
          `File ${file.name} exceeds ${APP_CONFIG.maxFileSizeMB} MB limit`
        );
      }
      const base64 = await fileToBase64(file);
      const safeName = sanitizeFileName(file.name);
      const documentId = generateId("doc");

      await apiPost({
        action: "uploadDocument",
        submissionId,
        applicationId,
        driveFolderId,
        documentId,
        categoryKey: group.categoryKey,
        categoryName: rule?.label || group.categoryKey,
        checklistOrder: rule?.order || 999,
        fileName: safeName,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        documentDate: group.documentDate || null,
        fileBase64: base64,
        auditUpdate:
          uploaded + 1 === audit.totalUploadedFiles
            ? {
                requiredCount: audit.requiredCount,
                uploadedRequiredCount: audit.uploadedRequiredCount,
                missingCount: audit.missingCount,
                completenessPercentage: audit.completenessPercentage,
                totalUploadedFiles: audit.totalUploadedFiles,
              }
            : null,
      });
      uploaded++;
    }
  }

  return {
    submissionId,
    applicationId,
    audit,
    submission: {
      id: submissionId,
      applicationId,
      ...applicantData,
      documentAudit: {
        requiredCount: audit.requiredCount,
        uploadedCount: audit.uploadedRequiredCount,
        missingCount: audit.missingCount,
        completenessPercentage: audit.completenessPercentage,
        totalUploadedFiles: audit.totalUploadedFiles,
      },
    },
  };
}

export async function listSubmissions() {
  const data = await apiPost({
    action: "listSubmissions",
    adminToken: GOOGLE_CONFIG.adminToken,
  });
  return data.submissions || [];
}

export async function getSubmission(submissionId) {
  const data = await apiPost({
    action: "getSubmission",
    adminToken: GOOGLE_CONFIG.adminToken,
    submissionId,
  });
  return data.submission || null;
}

export async function getSubmissionDocuments(submissionId) {
  const data = await apiPost({
    action: "getDocuments",
    adminToken: GOOGLE_CONFIG.adminToken,
    submissionId,
  });
  return data.documents || [];
}

export async function downloadDocumentAsArrayBuffer(driveFileId) {
  const data = await apiPost({
    action: "getFile",
    adminToken: GOOGLE_CONFIG.adminToken,
    driveFileId,
  });
  const binary = atob(data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function addDocumentsToSubmission(
  submissionId,
  driveFolderId,
  applicationId,
  filesByCategory,
  applicantForAudit
) {
  const existing = await getSubmissionDocuments(submissionId);
  const newMeta = [...existing];

  for (const group of filesByCategory) {
    const rule = DOCUMENT_RULES[group.categoryKey];
    for (const file of group.files) {
      const base64 = await fileToBase64(file);
      const safeName = sanitizeFileName(file.name);
      const documentId = generateId("doc");
      await apiPost({
        action: "uploadDocument",
        submissionId,
        applicationId,
        driveFolderId,
        documentId,
        categoryKey: group.categoryKey,
        categoryName: rule?.label || group.categoryKey,
        checklistOrder: rule?.order || 999,
        fileName: safeName,
        originalFileName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        documentDate: group.documentDate || null,
        fileBase64: base64,
      });
      newMeta.push({
        categoryKey: group.categoryKey,
        fileName: file.name,
        documentDate: group.documentDate,
      });
    }
  }

  const audit = auditDocuments(applicantForAudit, newMeta);
  await apiPost({
    action: "addDocuments",
    adminToken: GOOGLE_CONFIG.adminToken,
    submissionId,
    auditUpdate: {
      requiredCount: audit.requiredCount,
      uploadedRequiredCount: audit.uploadedRequiredCount,
      missingCount: audit.missingCount,
      completenessPercentage: audit.completenessPercentage,
      totalUploadedFiles: newMeta.length,
    },
  });
  return { audit };
}

export async function recordPdfGeneration(submissionId, meta) {
  try {
    await apiPost({
      action: "recordPdfGeneration",
      adminToken: GOOGLE_CONFIG.adminToken,
      submissionId,
      meta,
    });
  } catch (e) {
    console.warn("PDF history not recorded", e);
  }
}

/**
 * Visa Application — Google Apps Script backend
 * Sheets = metadata | Drive = document binaries
 *
 * SETUP: Set SPREADSHEET_ID, ROOT_FOLDER_ID, ADMIN_TOKEN.
 * Run initializeOnce() once, then Deploy as Web App (Execute as Me, Anyone).
 */

var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID";
var ROOT_FOLDER_ID = "YOUR_DRIVE_FOLDER_ID";
var ADMIN_TOKEN = "CHANGE_ME_TO_A_LONG_RANDOM_SECRET";
var APP_ID_PREFIX = "VISA-2026-";

var SHEET_SUBMISSIONS = "Submissions";
var SHEET_DOCUMENTS = "Documents";
var SHEET_COUNTERS = "Counters";

function initializeOnce() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var sub = ss.getSheetByName(SHEET_SUBMISSIONS);
  if (!sub) {
    sub = ss.insertSheet(SHEET_SUBMISSIONS);
    sub.appendRow([
      "submissionId", "applicationId", "applicantName", "email", "phone",
      "applicationLevel", "sponsorshipType", "passportNumber", "university",
      "course", "destinationCountry", "civilStatus", "isMinor", "nationality",
      "notes", "status", "submittedAt", "updatedAt", "requiredCount",
      "uploadedRequiredCount", "missingCount", "completenessPercentage",
      "totalUploadedFiles", "driveFolderId",
    ]);
  }

  var docs = ss.getSheetByName(SHEET_DOCUMENTS);
  if (!docs) {
    docs = ss.insertSheet(SHEET_DOCUMENTS);
    docs.appendRow([
      "documentId", "submissionId", "applicationId", "categoryKey", "categoryName",
      "checklistOrder", "fileName", "originalFileName", "mimeType", "size",
      "documentDate", "uploadedAt", "driveFileId",
    ]);
  }

  var ctr = ss.getSheetByName(SHEET_COUNTERS);
  if (!ctr) {
    ctr = ss.insertSheet(SHEET_COUNTERS);
    ctr.appendRow(["key", "value"]);
    ctr.appendRow(["applicationId", 0]);
  }

  DriveApp.getFolderById(ROOT_FOLDER_ID);
  Logger.log("Initialization complete.");
}

function doGet(e) {
  return jsonResponse({
    ok: true,
    service: "Visa Application Sheets+Drive API",
    actions: [
      "submit", "uploadDocument", "listSubmissions", "getSubmission",
      "getDocuments", "getFile", "addDocuments", "recordPdfGeneration",
    ],
  });
}

function doPost(e) {
  try {
    var body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      body = e.parameter;
    }

    var action = body.action || "";
    switch (action) {
      case "submit":
        return jsonResponse(handleSubmit(body));
      case "uploadDocument":
        return jsonResponse(handleUploadDocument(body));
      case "listSubmissions":
        requireAdmin(body);
        return jsonResponse(handleListSubmissions());
      case "getSubmission":
        requireAdmin(body);
        return jsonResponse(handleGetSubmission(body.submissionId));
      case "getDocuments":
        requireAdmin(body);
        return jsonResponse(handleGetDocuments(body.submissionId));
      case "getFile":
        requireAdmin(body);
        return jsonResponse(handleGetFile(body.driveFileId));
      case "addDocuments":
        requireAdmin(body);
        return jsonResponse(handleAddDocumentsMeta(body));
      case "recordPdfGeneration":
        requireAdmin(body);
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + action }, 400);
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) }, 500);
  }
}

function requireAdmin(body) {
  if (!body || body.adminToken !== ADMIN_TOKEN) {
    throw new Error("Unauthorized");
  }
}

function jsonResponse(obj, status) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

function nextApplicationId() {
  var sheet = getSheet(SHEET_COUNTERS);
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var current = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === "applicationId") {
      rowIndex = i + 1;
      current = Number(data[i][1]) || 0;
      break;
    }
  }
  var next = current + 1;
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 2).setValue(next);
  } else {
    sheet.appendRow(["applicationId", next]);
  }
  var padded = ("000000" + next).slice(-6);
  return APP_ID_PREFIX + padded;
}

function generateId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

function handleSubmit(body) {
  var applicant = body.applicant || {};
  var audit = body.audit || {};
  var submissionId = generateId("sub");
  var applicationId = nextApplicationId();
  var now = new Date().toISOString();

  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var folder = root.createFolder(applicationId + "_" + sanitizeName(applicant.applicantName || "Applicant"));
  var folderId = folder.getId();

  var sheet = getSheet(SHEET_SUBMISSIONS);
  sheet.appendRow([
    submissionId, applicationId,
    applicant.applicantName || "", applicant.email || "", applicant.phone || "",
    applicant.applicationLevel || "", applicant.sponsorshipType || "",
    applicant.passportNumber || "", applicant.university || "", applicant.course || "",
    applicant.destinationCountry || "", applicant.civilStatus || "single",
    applicant.isMinor ? "true" : "false", applicant.nationality || "Bangladeshi",
    applicant.notes || "", "submitted", now, now,
    audit.requiredCount || 0, audit.uploadedRequiredCount || 0,
    audit.missingCount || 0, audit.completenessPercentage || 0,
    audit.totalUploadedFiles || 0, folderId,
  ]);

  return {
    ok: true,
    submissionId: submissionId,
    applicationId: applicationId,
    driveFolderId: folderId,
  };
}

function handleUploadDocument(body) {
  if (!body.submissionId || !body.driveFolderId) {
    throw new Error("submissionId and driveFolderId required");
  }
  if (!body.fileBase64 || !body.fileName) {
    throw new Error("fileBase64 and fileName required");
  }

  var documentId = body.documentId || generateId("doc");
  var folder = DriveApp.getFolderById(body.driveFolderId);
  var bytes = Utilities.base64Decode(body.fileBase64);
  var blob = Utilities.newBlob(
    bytes,
    body.mimeType || "application/octet-stream",
    body.fileName
  );
  var file = folder.createFile(blob);

  var sheet = getSheet(SHEET_DOCUMENTS);
  sheet.appendRow([
    documentId, body.submissionId, body.applicationId || "",
    body.categoryKey || "", body.categoryName || "", body.checklistOrder || 999,
    body.fileName, body.originalFileName || body.fileName,
    body.mimeType || "", body.size || bytes.length,
    body.documentDate || "", new Date().toISOString(), file.getId(),
  ]);

  if (body.auditUpdate) {
    updateSubmissionAudit(body.submissionId, body.auditUpdate);
  }

  return { ok: true, documentId: documentId, driveFileId: file.getId() };
}

function updateSubmissionAudit(submissionId, audit) {
  var sheet = getSheet(SHEET_SUBMISSIONS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf("submissionId");
  var row = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] === submissionId) {
      row = i + 1;
      break;
    }
  }
  if (row < 0) return;

  function setCol(name, value) {
    var c = headers.indexOf(name);
    if (c >= 0) sheet.getRange(row, c + 1).setValue(value);
  }

  if (audit.requiredCount != null) setCol("requiredCount", audit.requiredCount);
  if (audit.uploadedRequiredCount != null) setCol("uploadedRequiredCount", audit.uploadedRequiredCount);
  if (audit.missingCount != null) setCol("missingCount", audit.missingCount);
  if (audit.completenessPercentage != null) setCol("completenessPercentage", audit.completenessPercentage);
  if (audit.totalUploadedFiles != null) setCol("totalUploadedFiles", audit.totalUploadedFiles);
  setCol("updatedAt", new Date().toISOString());
}

function handleListSubmissions() {
  var sheet = getSheet(SHEET_SUBMISSIONS);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, submissions: [] };

  var headers = data[0];
  var list = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    var obj = {};
    for (var h = 0; h < headers.length; h++) {
      obj[headers[h]] = row[h];
    }
    obj.id = obj.submissionId;
    obj.isMinor = String(obj.isMinor) === "true";
    obj.documentAudit = {
      requiredCount: Number(obj.requiredCount) || 0,
      uploadedCount: Number(obj.uploadedRequiredCount) || 0,
      missingCount: Number(obj.missingCount) || 0,
      completenessPercentage: Number(obj.completenessPercentage) || 0,
      totalUploadedFiles: Number(obj.totalUploadedFiles) || 0,
    };
    list.push(obj);
  }
  list.sort(function (a, b) {
    return String(b.submittedAt).localeCompare(String(a.submittedAt));
  });
  return { ok: true, submissions: list };
}

function handleGetSubmission(submissionId) {
  var result = handleListSubmissions();
  var found = null;
  for (var i = 0; i < result.submissions.length; i++) {
    if (result.submissions[i].submissionId === submissionId) {
      found = result.submissions[i];
      break;
    }
  }
  if (!found) return { ok: false, error: "Not found" };
  return { ok: true, submission: found };
}

function handleGetDocuments(submissionId) {
  var sheet = getSheet(SHEET_DOCUMENTS);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: true, documents: [] };

  var headers = data[0];
  var idCol = headers.indexOf("submissionId");
  var list = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][idCol] !== submissionId) continue;
    var obj = {};
    for (var h = 0; h < headers.length; h++) {
      obj[headers[h]] = data[i][h];
    }
    obj.id = obj.documentId;
    obj.storagePath = obj.driveFileId;
    list.push(obj);
  }
  return { ok: true, documents: list };
}

function handleGetFile(driveFileId) {
  if (!driveFileId) throw new Error("driveFileId required");
  var file = DriveApp.getFileById(driveFileId);
  var blob = file.getBlob();
  var b64 = Utilities.base64Encode(blob.getBytes());
  return {
    ok: true,
    fileName: file.getName(),
    mimeType: blob.getContentType(),
    base64: b64,
    size: blob.getBytes().length,
  };
}

function handleAddDocumentsMeta(body) {
  if (body.auditUpdate && body.submissionId) {
    updateSubmissionAudit(body.submissionId, body.auditUpdate);
  }
  return { ok: true };
}

function sanitizeName(name) {
  return String(name || "Applicant")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

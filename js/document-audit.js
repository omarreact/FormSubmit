/**
 * Document Audit Engine
 * Calculates required / uploaded / missing documents for an applicant.
 */

import {
  DOCUMENT_RULES,
  getOrderedRules,
  isDocumentRequired,
  getApplicableRules,
} from "./document-rules.js";

export function auditDocuments(applicant, uploadedDocs = []) {
  const applicable = getApplicableRules(applicant);
  const uploadedByCategory = {};

  for (const doc of uploadedDocs) {
    const key = doc.categoryKey;
    if (!uploadedByCategory[key]) uploadedByCategory[key] = [];
    uploadedByCategory[key].push(doc);
  }

  const results = [];
  let requiredCount = 0;
  let uploadedRequiredCount = 0;
  let missingRequired = [];
  let optionalMissing = [];

  for (const rule of applicable) {
    const required = isDocumentRequired(rule, applicant);
    const files = uploadedByCategory[rule.key] || [];
    const hasFiles = files.length > 0;

    if (required) requiredCount++;

    const item = {
      key: rule.key,
      label: rule.label,
      section: rule.section,
      order: rule.order,
      required,
      uploaded: hasFiles,
      fileCount: files.length,
      files,
      notRequiredMessage: rule.notRequiredMessage || null,
    };

    if (required && !hasFiles) {
      missingRequired.push(item);
    } else if (!required && !hasFiles) {
      optionalMissing.push(item);
    }

    if (required && hasFiles) uploadedRequiredCount++;

    results.push(item);
  }

  const completenessPercentage =
    requiredCount === 0
      ? 100
      : Math.round((uploadedRequiredCount / requiredCount) * 100);

  return {
    results,
    requiredCount,
    uploadedRequiredCount,
    missingCount: missingRequired.length,
    missingRequired,
    optionalMissing,
    completenessPercentage,
    totalApplicable: applicable.length,
    totalUploadedFiles: uploadedDocs.length,
  };
}

export function sortDocumentsForPdf(uploadedDocs) {
  return [...uploadedDocs].sort((a, b) => {
    const ruleA = DOCUMENT_RULES[a.categoryKey];
    const ruleB = DOCUMENT_RULES[b.categoryKey];
    const orderA = ruleA ? ruleA.order : 999;
    const orderB = ruleB ? ruleB.order : 999;
    if (orderA !== orderB) return orderA - orderB;

    const dateA = a.documentDate || "";
    const dateB = b.documentDate || "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const upA = a.uploadedAt || "";
    const upB = b.uploadedAt || "";
    if (upA !== upB) return upA.localeCompare(upB);

    return (a.fileName || "").localeCompare(b.fileName || "");
  });
}

export function groupByCategory(sortedDocs) {
  const groups = [];
  let currentKey = null;
  let currentGroup = null;

  for (const doc of sortedDocs) {
    if (doc.categoryKey !== currentKey) {
      currentKey = doc.categoryKey;
      const rule = DOCUMENT_RULES[currentKey];
      currentGroup = {
        key: currentKey,
        label: rule ? rule.label : currentKey,
        order: rule ? rule.order : 999,
        docs: [],
      };
      groups.push(currentGroup);
    }
    currentGroup.docs.push(doc);
  }
  return groups;
}

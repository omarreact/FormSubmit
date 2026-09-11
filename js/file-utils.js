/**
 * File utilities – validation, hashing, sanitization, size formatting
 */

import { APP_CONFIG } from "./config.js";

export function sanitizeFileName(name) {
  if (!name) return "unnamed";
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function validateFile(file) {
  if (!file) {
    return { valid: false, error: "No file selected" };
  }
  if (file.size > APP_CONFIG.maxFileSizeBytes) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${APP_CONFIG.maxFileSizeMB} MB`,
    };
  }
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  const extOk = APP_CONFIG.acceptedExtensions.some((ext) => name.endsWith(ext));
  const typeOk =
    APP_CONFIG.acceptedFileTypes.includes(type) ||
    type === "application/octet-stream";

  if (!typeOk && !extOk) {
    return {
      valid: false,
      error: "Unsupported file type. Allowed: PDF, JPG, JPEG, PNG",
    };
  }
  return { valid: true };
}

export async function computeSHA256(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

export function generateId(prefix = "") {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return prefix ? `${prefix}_${time}_${rand}` : `${time}_${rand}`;
}

export function toISODate(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function formatDisplayDate(isoOrDate) {
  if (!isoOrDate) return "—";
  try {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

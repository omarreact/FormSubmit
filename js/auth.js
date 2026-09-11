/**
 * Simple admin gate using shared token (matches Apps Script ADMIN_TOKEN)
 */

import { GOOGLE_CONFIG, ADMIN_SESSION_KEY } from "./config.js";

export function validateAdminToken(token) {
  if (!token || !GOOGLE_CONFIG.adminToken) return false;
  if (GOOGLE_CONFIG.adminToken.includes("CHANGE_ME")) {
    console.warn("Default admin token still in use — change it before production.");
  }
  return token === GOOGLE_CONFIG.adminToken;
}

export function signInWithToken(token) {
  if (!validateAdminToken(token)) {
    throw new Error("Invalid admin token");
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
  return true;
}

export function signOut() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export function isAdminAuthenticated() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
}

export async function requireAdmin() {
  const ok = isAdminAuthenticated();
  return { user: ok ? { email: "admin" } : null, isAdmin: ok };
}

export async function getCurrentUser() {
  return isAdminAuthenticated() ? { email: "admin" } : null;
}

export function onAuthStateChanged(callback) {
  Promise.resolve().then(() => {
    const user = isAdminAuthenticated() ? { email: "admin" } : null;
    callback(user);
  });
  return Promise.resolve(() => {});
}

export async function isAdminUser(user) {
  return !!user && isAdminAuthenticated();
}

export async function signIn() {
  throw new Error("Use signInWithToken(token) for Sheets+Drive mode");
}

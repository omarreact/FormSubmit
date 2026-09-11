# Visa Application Document Submission & PDF Dossier Generator (2026)

Collect visa supporting documents from applicants and generate a **single self-contained PDF dossier** for administrators.

**Storage:** Google Sheets (metadata) + Google Drive (files) via a **Google Apps Script** web app.  
**Frontend:** HTML5 + Bootstrap 5 + Vanilla JavaScript (no React/Vue).  
**PDF:** Client-side [pdf-lib](https://pdf-lib.js.org/) in the admin browser.

---

## Live site

- Form: https://omarreact.github.io/FormSubmit/
- Admin: https://omarreact.github.io/FormSubmit/admin.html

---

## Features

- Public applicant form with conditional checklist (Master’s, sponsorship, civil status, minors, etc.)
- Multi-file uploads (PDF / JPG / PNG) with optional document dates
- Apostille upload with client-side scan (page count / image size)
- Missing-document confirmation; Application ID `VISA-2026-######`
- Admin dashboard: metrics, search, filters, CSV export
- **One combined PDF** with summary, checklist, missing warnings, and **actual** document pages
- SHA-256 deduplication, corrupted-file isolation, progress stages

---

## Architecture

```
Applicant browser                    Google (your account)
─────────────────                    ────────────────────
index.html  ──POST JSON+base64──►  Apps Script Web App
                                   ├─ append row → Spreadsheet (Submissions / Documents)
                                   └─ create files → Drive folder per application

Admin browser
─────────────
admin.html  ──token + actions──►  Apps Script
            ◄── metadata + file base64 ──
            ── pdf-lib merge (local) ──►  download dossier PDF
```

Binaries are **never** stored in the Sheet. Only Drive file IDs and metadata are recorded.

---

## Setup (Google Sheets + Drive)

### 1. Spreadsheet

1. Create a new [Google Sheet](https://sheets.google.com).
2. Copy the **Spreadsheet ID** from the URL:  
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### 2. Drive folder

1. Create a folder in [Google Drive](https://drive.google.com) (e.g. `VisaSubmissions2026`).
2. Copy the **Folder ID** from the URL:  
   `https://drive.google.com/drive/folders/FOLDER_ID`

### 3. Apps Script project

1. Open [script.google.com](https://script.google.com) → New project.
2. Replace `Code.gs` with the contents of `apps-script/Code.gs`.
3. Set at the top of the script:

```javascript
var SPREADSHEET_ID = "your_spreadsheet_id";
var ROOT_FOLDER_ID = "your_folder_id";
var ADMIN_TOKEN = "a_long_random_secret_you_choose";
```

4. Select function `initializeOnce` → **Run** (authorize Google account when prompted).  
   This creates sheets: `Submissions`, `Documents`, `Counters`.
5. **Deploy** → **New deployment** → Type: **Web app**
   - Description: `visa-api`
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Authorize and copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).

### 4. Frontend config

Edit `js/config.js`:

```js
export const GOOGLE_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/XXXX/exec",
  adminToken: "a_long_random_secret_you_choose", // same as Code.gs
};
```

Commit and push so GitHub Pages picks up the URL.

---

## Admin access

Sign in on `admin.html` with the **admin token** (not a Google password).  
Change `ADMIN_TOKEN` in both Code.gs and `config.js` before production.

---

## Applicant workflow

1. Complete profile and uploads.
2. Submit → Apps Script creates Application ID, Sheet row, Drive folder.
3. Each file is uploaded (base64) into that Drive folder; a `Documents` row stores the Drive file ID.
4. Success screen shows Application ID.

## Admin PDF workflow

1. Sign in with admin token.
2. Select applicant (unique submission / Application ID).
3. Review completeness and missing warnings.
4. **DOWNLOAD APPLICANT PDF** → progress modal → browser downloads a self-contained PDF.

The PDF includes real pages (multi-page PDFs kept in full; images centered on A4). It works **offline** after download — no Drive links required inside the PDF.

---

## Troubleshooting

| Issue | Check |
|-------|--------|
| “Web App URL is not configured” | `js/config.js` |
| Invalid response / HTML error page | Redeploy web app; Access = Anyone; Execute as Me |
| Unauthorized on admin | Token mismatch between `config.js` and `Code.gs` |
| Upload fails on large file | Reduce size; check Apps Script executions log |
| Empty admin list | Run `initializeOnce`; confirm spreadsheet ID |
| PDF missing pages | Confirm Documents rows have `driveFileId` |

View logs: Apps Script editor → **Executions**.

---

## License / compliance

Handle passports, NIDs, and bank statements according to your organization’s data-protection rules. Restrict who knows the admin token and who owns the Google account that runs the script.

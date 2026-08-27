/**
 * Side panel controller: download template → upload → parse → validate →
 * review. No Gmail/Mailsuite code here — see manifest.json/README for why.
 */
import { validateRows } from './lib/validate.js';
import {
  loadCategoriesBrowser,
  parseSheetFromArrayBuffer,
  saveBatch,
  loadBatch,
  resetBatch,
} from './lib/browser-excel.js';

const downloadTemplateButton = document.getElementById('download-template');
const uploadInput = document.getElementById('upload-input');
const uploadStatus = document.getElementById('upload-status');
const reviewSection = document.getElementById('review-section');
const summaryLine = document.getElementById('summary-line');
const reviewBody = document.getElementById('review-body');
const clearBatchButton = document.getElementById('clear-batch');
const sendTestRowButton = document.getElementById('send-test-row');
const testRowStatus = document.getElementById('test-row-status');

let currentBatch = null; // { fileName, rawRows, result } — see renderReview()

downloadTemplateButton.addEventListener('click', () => {
  chrome.downloads.download({
    url: chrome.runtime.getURL('templates/blank/prospects.xlsx'),
    filename: 'prospects.xlsx',
    saveAs: false,
  });
});

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;

  uploadStatus.textContent = `Parsing ${file.name}…`;
  uploadStatus.classList.remove('error');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const rawRows = await parseSheetFromArrayBuffer(arrayBuffer);

    // templates/categories/index.json is generated at build time (see
    // scripts/build-extension.js) — a browser extension has no fs.readdir()
    // to discover the category files the way src/excel.js's loadCategories()
    // does, so the file list itself has to be a build artifact.
    const indexUrl = chrome.runtime.getURL('templates/categories/index.json');
    const categoryFileNames = await (await fetch(indexUrl)).json();
    const knownCategories = await loadCategoriesBrowser(categoryFileNames);

    const result = validateRows(rawRows, knownCategories);

    await saveBatch({ fileName: file.name, rawRows, result });
    renderReview(file.name, rawRows, result);

    uploadStatus.textContent = `Parsed ${file.name}.`;
  } catch (error) {
    console.error(error);
    uploadStatus.textContent = `Couldn't parse ${file.name}: ${error.message}`;
    uploadStatus.classList.add('error');
  }
});

clearBatchButton.addEventListener('click', async () => {
  await resetBatch();
  currentBatch = null;
  sendTestRowButton.disabled = true;
  testRowStatus.textContent = '';
  reviewSection.hidden = true;
  reviewBody.innerHTML = '';
  uploadInput.value = '';
  uploadStatus.textContent = '';
});

sendTestRowButton.addEventListener('click', async () => {
  const row = currentBatch?.result.ready[0];
  if (!row) return;

  sendTestRowButton.disabled = true;
  testRowStatus.classList.remove('error');
  testRowStatus.textContent = `Sending row ${row.__row} (${row.email})… a dedicated Gmail tab will open.`;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'PROSPECT_REACH_SEND_TEST_ROW',
      row,
    });

    if (result?.success) {
      testRowStatus.textContent = `Row ${row.__row} sent successfully.`;
    } else {
      testRowStatus.textContent = `Row ${row.__row} failed: ${result?.error ?? 'unknown error'}`;
      testRowStatus.classList.add('error');
    }
  } catch (error) {
    testRowStatus.textContent = `Row ${row.__row} failed: ${error.message}`;
    testRowStatus.classList.add('error');
  } finally {
    sendTestRowButton.disabled = false;
  }
});

function rowStatus(rowNumber, result) {
  if (result.errors.some((e) => e.row === rowNumber)) return 'error';
  if (result.warnings.some((w) => w.row === rowNumber)) return 'warning';
  if (result.ready.some((r) => r.__row === rowNumber)) return 'ready';
  return null; // the untouched example row — excluded from review entirely
}

function reasonFor(rowNumber, result) {
  const error = result.errors.find((e) => e.row === rowNumber);
  if (error) return error.message;
  const warning = result.warnings.find((w) => w.row === rowNumber);
  if (warning) return warning.message;
  return '';
}

function renderReview(fileName, rawRows, result) {
  currentBatch = { fileName, rawRows, result };
  sendTestRowButton.disabled = result.ready.length === 0;

  reviewSection.hidden = false;
  summaryLine.textContent =
    `${fileName} — ${result.ready.length} ready, ${result.warnings.length} warning(s), ` +
    `${result.errors.length} error(s)`;

  reviewBody.innerHTML = '';
  for (const row of rawRows) {
    const status = rowStatus(row.__row, result);
    if (!status) continue; // skip the untouched example row

    const tr = document.createElement('tr');
    tr.className = `status-${status}`;
    tr.innerHTML = `
      <td>${row.__row}</td>
      <td>${escapeHtml(row.name ?? '')}</td>
      <td>${escapeHtml(row.email ?? '')}</td>
      <td>${escapeHtml(row.company ?? '')}</td>
      <td>${escapeHtml(row.category ?? '')}</td>
      <td class="status-cell">${status}</td>
      <td>${escapeHtml(reasonFor(row.__row, result))}</td>
    `;
    reviewBody.appendChild(tr);
  }
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// Restore a persisted batch on reopen, so the review table survives the
// side panel being closed and reopened mid-review.
(async () => {
  const batch = await loadBatch();
  if (batch) {
    renderReview(batch.fileName, batch.rawRows, batch.result);
    uploadStatus.textContent = `Restored ${batch.fileName} from your last session.`;
  }
})();

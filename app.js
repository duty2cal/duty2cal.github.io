// SPDX-License-Identifier: MPL-2.0
// Converter page module. It initializes the WASM instance from the inlined
// bytes (no fetch: the CSP forbids one), owns the in-memory offer, and routes
// each supplied plan to the unchanged application boundary.

import init, { convert, diagnostic_text } from './pkg/duty2cal_wasm.js';
import { wasmBase64 } from './pkg/wasm-inline.js';

/** The page's size bound, checked before the file is read. */
const MAX_BYTES = 20 * 1024 * 1024;

/** Live object URLs, revoked when an attempt is replaced. */
let offers = [];

/** The current WASM instance's usability; a trap forces a fresh instance. */
let instanceReady = false;
let needsReinit = false;

const status = document.getElementById('status');
const choose = document.getElementById('choose');
const picker = document.getElementById('plan');
const dropZone = document.getElementById('drop-zone');
const actions = document.getElementById('plan-actions');
const offerArea = document.getElementById('offer');
const offerLinks = document.getElementById('offer-links');
const offerCopy = document.getElementById('offer-copy');
const readyStatus = document.getElementById('ready-status');
const offerNote = document.getElementById('offer-note');
const warningsBlock = document.getElementById('warnings');
const warningList = document.getElementById('warning-list');
const failure = document.getElementById('failure');
const failureReason = document.getElementById('failure-reason');
const failureErrors = document.getElementById('failure-errors');
const errorList = document.getElementById('error-list');
const failureWarnings = document.getElementById('failure-warnings');
const failureWarningList = document.getElementById('failure-warning-list');
const failureOffer = document.getElementById('failure-offer');
const failureNote = document.getElementById('failure-note');
const reset = document.getElementById('reset');
const resetReady = document.getElementById('reset-ready');

/** Decode the build-time base64 string into the bytes `init` instantiates. */
function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The supplied name without its final extension; a leading dot is not one. */
function stemOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The shared two-line diagnostic, with the page's last-resort spelling. */
function safeDiagnostic(name, reason) {
  try {
    return diagnostic_text(name, reason);
  } catch {
    return `Source PDF: ${name}\nReason: ${reason}\n`;
  }
}

/** Revoke and remove every offer from the previous attempt. */
function withdrawOffers() {
  for (const url of offers) {
    URL.revokeObjectURL(url);
  }
  offers = [];
  offerLinks.replaceChildren();
  offerArea.hidden = true;
  failureOffer.replaceChildren();
}

/** Reset the page to its empty state. */
function clearAttempt() {
  withdrawOffers();
  failure.hidden = true;
  failureReason.textContent = '';
  renderList(warningsBlock, warningList, []);
  renderList(failureErrors, errorList, []);
  renderList(failureWarnings, failureWarningList, []);
  readyStatus.textContent = '';
  offerNote.textContent = '';
  offerNote.hidden = true;
  status.textContent = 'No plan selected.';
  setControlsDisabled(false);
}

/** Fill or hide one diagnostic list. */
function renderList(container, list, items) {
  list.replaceChildren();
  for (const item of items) {
    const entry = document.createElement('li');
    entry.textContent = item;
    list.append(entry);
  }
  container.hidden = items.length === 0;
}

/** An English count word up to twenty, digits above. */
function countWord(count) {
  const words = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ];
  return count <= 20 ? words[count] : String(count);
}

/** The count-based sentence the failure state shows above its lists. */
function summarizeFailure(name, errors, warnings) {
  const rows = (count) => `${countWord(count)} ${count === 1 ? 'row' : 'rows'}`;
  const parts = [];
  if (errors > 0) {
    parts.push(`${rows(errors)} that cannot be represented`);
  }
  if (warnings > 0) {
    const verb = warnings === 1 ? 'was' : 'were';
    const noun = warnings === 1 ? 'a warning' : 'warnings';
    parts.push(`${rows(warnings)} that ${verb} converted with ${noun}`);
  }
  if (parts.length === 0) {
    return '';
  }
  return `${name}: the plan has ${parts.join(' and ')}.`;
}

/** Enable or disable the plan controls while an attempt is in flight. */
function setControlsDisabled(disabled) {
  choose.disabled = disabled;
  picker.disabled = disabled;
  dropZone.setAttribute('aria-disabled', String(disabled));
}

/** Instantiate the module again after a trap, or on first use. */
async function ensureInstance() {
  if (!instanceReady || needsReinit) {
    await init(decodeBase64(wasmBase64));
    instanceReady = true;
    needsReinit = false;
  }
}

/** Add one in-memory download offer to a container. */
function addOffer(container, name, content, type, label = `Save ${name}`) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  offers.push(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.className = 'button';
  link.textContent = label;
  container.append(link);
}

/** One ready-list line for a represented unknown duty. */
function unknownDutyLine(duty) {
  const prefix = duty.start
    ? `${duty.date} ${duty.start} UTC`
    : duty.date;
  return `${prefix} unknown duty: ${duty.code}`;
}

/** Show the ready state for a complete calendar, with its unknown duties. */
function showReady(name, calendar, warnings, warningReport, unknownDuties) {
  try {
    addOffer(
      offerLinks,
      `${stemOf(name)}.ics`,
      calendar,
      'text/calendar;charset=utf-8',
    );
  } catch {
    // Success is never reported without an offer: this is a failure.
    const reason = 'the calendar could not be offered for saving';
    showFailure(name, reason, safeDiagnostic(name, reason), [], []);
    return;
  }

  const hasWarnings = warnings.length > 0;
  if (hasWarnings && warningReport) {
    try {
      addOffer(
        offerLinks,
        `${stemOf(name)}.parse-warnings.txt`,
        warningReport,
        'text/plain;charset=utf-8',
        'Save unknown duty warning for publisher',
      );
    } catch {
      // Keep the calendar and its visible warnings; say what is missing.
      offerNote.textContent = 'No warning report was offered.';
      offerNote.hidden = false;
    }
  }

  renderList(warningsBlock, warningList, unknownDuties.map(unknownDutyLine));
  if (unknownDuties.length > 0) {
    const rows =
      unknownDuties.length === 1
        ? '1 row was'
        : `${unknownDuties.length} rows were`;
    const noun =
      unknownDuties.length === 1 ? 'an unknown duty' : 'unknown duties';
    readyStatus.textContent = `Your calendar is ready to save. ${rows} converted with ${noun}.`;
  } else {
    readyStatus.textContent = `Calendar ready for ${name}.`;
  }
  status.textContent = '';
  offerArea.hidden = false;
}

/** Show the visible failure, with both lists and the report offer. */
function showFailure(name, reason, diagnostic, errors, warnings) {
  status.textContent = '';
  readyStatus.textContent = '';
  failureReason.textContent =
    summarizeFailure(name, errors.length, warnings.length) || `${name}: ${reason}`;
  renderList(failureErrors, errorList, errors);
  renderList(failureWarnings, failureWarningList, warnings);
  failureNote.textContent = '';
  failureNote.hidden = true;
  if (diagnostic) {
    try {
      addOffer(
        failureOffer,
        `${stemOf(name)}.parse-error.txt`,
        diagnostic,
        'text/plain;charset=utf-8',
      );
      failureNote.textContent =
        'The report names the source, the reason, and every error and warning.';
      failureNote.hidden = false;
    } catch {
      // Keep the primary failure and say the diagnostic is unavailable.
      failureNote.textContent = 'No diagnostic was offered.';
      failureNote.hidden = false;
    }
  }
  failure.hidden = false;
}

/** Supply one file: clear the previous attempt, guard its size, convert. */
async function acceptFile(file) {
  clearAttempt();
  const name = file.name;

  if (file.size > MAX_BYTES) {
    const reason = 'the plan is larger than the 20 MiB supported size bound';
    showFailure(name, reason, safeDiagnostic(name, reason), [], []);
    return;
  }

  status.textContent = 'Converting…';
  setControlsDisabled(true);

  try {
    await ensureInstance();
  } catch {
    needsReinit = true;
    const reason = 'the converter could not be restarted in this browser';
    showFailure(name, reason, safeDiagnostic(name, reason), [], []);
    setControlsDisabled(false);
    return;
  }

  let result;
  try {
    const buffer = await file.arrayBuffer();
    result = convert(name, new Uint8Array(buffer));
  } catch {
    // A trap or any other non-structured exception: discard the instance so
    // the next attempt starts fresh, offer no partial calendar, and keep the
    // shared two-line diagnostic spelling.
    needsReinit = true;
    const reason = 'the plan could not be processed in this browser';
    showFailure(name, reason, safeDiagnostic(name, reason), [], []);
    setControlsDisabled(false);
    return;
  }

  setControlsDisabled(false);
  if (result && result.status === 'ok' && typeof result.calendar === 'string') {
    showReady(
      name,
      result.calendar,
      (result && result.warnings) || [],
      (result && result.warningReport) || '',
      (result && result.unknownDuties) || [],
    );
    return;
  }

  const reason =
    (result && result.reason) || 'the plan could not be processed in this browser';
  const diagnostic =
    (result && result.diagnostic) || safeDiagnostic(name, reason);
  showFailure(name, reason, diagnostic, (result && result.errors) || [], (result && result.warnings) || []);
}

/** Wire the picker and the way back once the module is usable. */
function wireControls() {
  choose.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    const file = picker.files && picker.files[0];
    if (file) {
      acceptFile(file);
    }
  });
  for (const type of ['dragenter', 'dragover']) {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
    });
  }
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer && event.dataTransfer.files[0];
    if (file) {
      acceptFile(file);
    }
  });
  reset.addEventListener('click', () => {
    picker.value = '';
    clearAttempt();
  });
  resetReady.addEventListener('click', () => {
    picker.value = '';
    clearAttempt();
  });
}

/** Show the startup failure and leave the picker hidden. */
function showStartupFailure() {
  const reason = document.getElementById('cannot-run-reason');
  if (reason) {
    reason.textContent = 'The converter could not start in this browser.';
  }
  const panel = document.getElementById('cannot-run');
  if (panel) {
    panel.hidden = false;
  }
}

/** Instantiate the module and reveal the controls on success. */
async function start() {
  if (document.documentElement.dataset.duty2calSupported !== 'true') {
    return;
  }
  try {
    await ensureInstance();
  } catch {
    showStartupFailure();
    return;
  }
  wireControls();
  if (actions) {
    actions.hidden = false;
  }
}

// The plan and its derived files never outlive the tab: every live object URL
// is revoked when the page is unloaded.
window.addEventListener('pagehide', () => {
  for (const url of offers) {
    URL.revokeObjectURL(url);
  }
  offers = [];
});

start();

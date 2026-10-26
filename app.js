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
const failure = document.getElementById('failure');
const failureReason = document.getElementById('failure-reason');
const failureOffer = document.getElementById('failure-offer');
const failureNote = document.getElementById('failure-note');
const reset = document.getElementById('reset');

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
  offerArea.replaceChildren();
  offerArea.hidden = true;
  failureOffer.replaceChildren();
}

/** Reset the page to its empty state. */
function clearAttempt() {
  withdrawOffers();
  failure.hidden = true;
  failureReason.textContent = '';
  status.textContent = 'No plan selected.';
  setControlsDisabled(false);
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
function addOffer(container, name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  offers.push(url);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.className = 'button';
  link.textContent = `Save ${name}`;
  container.append(link);
}

/** Make the complete calendar available for saving. */
function offerCalendar(name, calendar) {
  addOffer(
    offerArea,
    `${stemOf(name)}.ics`,
    calendar,
    'text/calendar;charset=utf-8',
  );
}

/** Show the ready state for a complete calendar. */
function showReady(name, calendar) {
  try {
    offerCalendar(name, calendar);
  } catch {
    // Success is never reported without an offer: this is a failure.
    const reason = 'the calendar could not be offered for saving';
    showFailure(name, reason, safeDiagnostic(name, reason));
    return;
  }
  status.textContent = 'Your calendar is ready to save.';
  const heading = document.createElement('h2');
  heading.textContent = 'Calendar ready';
  offerArea.prepend(heading);
  const note = document.createElement('p');
  note.className = 'offer-note';
  note.textContent = 'Your browser chooses where to save it.';
  offerArea.append(note);
  offerArea.hidden = false;
}

/** Show the visible failure, with the diagnostic offer when it exists. */
function showFailure(name, reason, diagnostic) {
  status.textContent = 'No calendar was created.';
  failureReason.textContent = `${name}: ${reason}`;
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
    showFailure(name, reason, safeDiagnostic(name, reason));
    return;
  }

  status.textContent = 'Converting…';
  setControlsDisabled(true);

  try {
    await ensureInstance();
  } catch {
    needsReinit = true;
    const reason = 'the converter could not be restarted in this browser';
    showFailure(name, reason, safeDiagnostic(name, reason));
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
    showFailure(name, reason, safeDiagnostic(name, reason));
    setControlsDisabled(false);
    return;
  }

  setControlsDisabled(false);
  if (result && result.status === 'ok' && typeof result.calendar === 'string') {
    showReady(name, result.calendar);
    return;
  }

  const reason =
    (result && result.reason) || 'the plan could not be processed in this browser';
  const diagnostic =
    (result && result.diagnostic) || safeDiagnostic(name, reason);
  showFailure(name, reason, diagnostic);
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

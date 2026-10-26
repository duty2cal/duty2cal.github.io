// SPDX-License-Identifier: MPL-2.0
// Classic capability gate (design.md "Capability gate and loading"). It runs
// before the module script: a browser without WebAssembly or ES modules sees
// the cannot-run message and never sees a file picker.
(() => {
  'use strict';

  const hasWasm =
    typeof WebAssembly === 'object' &&
    typeof WebAssembly.instantiate === 'function';
  const hasModules =
    typeof HTMLScriptElement.supports === 'function'
      ? HTMLScriptElement.supports('module')
      : 'noModule' in document.createElement('script');

  const supported = hasWasm && hasModules;
  document.documentElement.dataset.duty2calSupported = String(supported);
  if (supported) {
    return;
  }

  const panel = document.getElementById('cannot-run');
  const reason = document.getElementById('cannot-run-reason');
  if (reason) {
    reason.textContent = hasWasm
      ? 'This browser does not support ES modules, which the converter needs.'
      : 'This browser does not support WebAssembly, which the converter needs.';
  }
  if (panel) {
    panel.hidden = false;
  }
})();

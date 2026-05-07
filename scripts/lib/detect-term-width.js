'use strict';

/**
 * detect-term-width.js — detect terminal column width when all fds are piped.
 *
 * Export:
 *   detectTermWidth() → number  (0 when terminal width cannot be determined)
 *
 * Extraction source: scripts/statusline.js v4.7.0 lines 803-819.
 * Semantics are byte-identical to the original (NFR-3).
 *
 * Opens the controlling terminal device directly:
 *   Windows: \\.\CONOUT$
 *   Unix:    /dev/tty
 *
 * Returns 0 if the terminal device is unavailable (e.g. CI / fully headless).
 *
 * Zero new npm dependencies (NFR-4).
 */

const fs = require('fs');

/**
 * Detect terminal column width by opening the controlling terminal directly.
 *
 * Claude Code pipes stdin/stdout/stderr, which makes process.stdout.columns
 * return 0. This function bypasses the piped fds by opening CONOUT$ or /dev/tty.
 *
 * @returns {number} Number of terminal columns, or 0 if undetectable.
 */
function detectTermWidth() {
  const tty = require('tty');
  try {
    const dev = process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty';
    const fd = fs.openSync(dev, fs.constants.O_RDWR);
    try {
      const stream = new tty.WriteStream(fd);
      const cols = stream.columns || 0;
      stream.destroy();
      return cols;
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch {
    return 0;
  }
}

module.exports = { detectTermWidth };

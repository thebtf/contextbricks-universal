'use strict';

/**
 * ansi.js — shared ANSI color constants
 *
 * Extracted from scripts/statusline.js v4.7.0 lines 110-125.
 * Single source of truth for all ANSI escape sequences used by
 * rate-view.js and format/* modules.
 *
 * Per spec.md NFR-3 (byte-identical output for v4.7.0-equivalent input).
 */

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[1;36m',
  green: '\x1b[1;32m',
  blue: '\x1b[1;34m',
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m',
  dimWhite: '\x1b[2;37m',
  greenNorm: '\x1b[0;32m',
  redNorm: '\x1b[0;31m',
  cyanNorm: '\x1b[0;36m',
  yellowNorm: '\x1b[0;33m',
};

module.exports = { c };

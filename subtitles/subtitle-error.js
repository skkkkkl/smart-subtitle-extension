/*
 * Typed, user-presentable errors. No DOM or Chrome APIs, so this module can be
 * reused by an Android/other-browser host later.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.subtitles.SubtitleError = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class SubtitleError extends Error {
    /**
     * @param {string} code stable machine-readable code
     * @param {string} message Chinese user-facing message
     * @param {{line?: number|null, details?: unknown, cause?: unknown}} [options]
     */
    constructor(code, message, options) {
      super(message);
      this.name = 'SubtitleError';
      this.code = code;
      this.line = options && Number.isInteger(options.line) ? options.line : null;
      this.details = options && options.details !== undefined ? options.details : null;
      if (options && options.cause !== undefined) {
        this.cause = options.cause;
      }
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, SubtitleError);
      }
    }
  }

  function isSubtitleError(value) {
    return value instanceof SubtitleError;
  }

  function getErrorMessage(value, fallback) {
    if (value && typeof value.message === 'string' && value.message.trim()) {
      return value.message;
    }
    return fallback || '发生未知错误。';
  }

  return { SubtitleError, isSubtitleError, getErrorMessage };
});

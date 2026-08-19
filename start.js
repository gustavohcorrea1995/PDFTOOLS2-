const childProcess = require('child_process');

// Poppler's -jpegopt is valid only for JPEG output.
// Keep the existing server implementation intact while normalizing
// PDF -> PNG arguments at process start.
const originalExecFile = childProcess.execFile;
childProcess.execFile = function patchedExecFile(command, args, options, callback) {
  if (command === 'pdftocairo' && Array.isArray(args)) {
    const normalized = [...args];
    const png = normalized.includes('-png');
    if (png) {
      for (let i = normalized.length - 1; i >= 0; i--) {
        if (normalized[i] === '-jpegopt') {
          normalized.splice(i, 2);
        }
      }
    }
    args = normalized;
  }
  return originalExecFile.call(this, command, args, options, callback);
};

require('./server.js');

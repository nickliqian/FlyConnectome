(function (root) {
  'use strict';
  const sceneFields = new Set(['spawn', 'friction', 'adhesion', 'seed', 'duration']);
  function reconcileConfig(draft, applied, options = {}) {
    const next = structuredClone(draft);
    const pending = structuredClone(options.pending || {});
    if (options.stagedPreset) return {draft: next, pending};
    for (const [key, edit] of Object.entries(pending)) {
      if (edit.commandId != null && (options.ackId || 0) >= edit.commandId) delete pending[key];
    }
    for (const [key, value] of Object.entries(applied)) {
      if (pending[key] || (options.sceneDirty && sceneFields.has(key))) continue;
      next[key] = structuredClone(value);
    }
    return {draft: next, pending};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {reconcileConfig};
  else root.FlyConfigSync = {reconcileConfig};
})(typeof window === 'undefined' ? {} : window);

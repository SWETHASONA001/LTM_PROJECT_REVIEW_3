/// <reference lib="webworker" />
import { optimizeLayout, type OptimizeInput } from '../physics/optimizer';

self.onmessage = (ev: MessageEvent<OptimizeInput>) => {
  try {
    const out = optimizeLayout(ev.data, (p) => self.postMessage({ type: 'progress', progress: p }));
    self.postMessage({ type: 'done', result: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

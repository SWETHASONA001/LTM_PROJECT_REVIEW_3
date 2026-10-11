/// <reference lib="webworker" />
import { recommendSites, type SitingInput } from '../physics/siting';

self.onmessage = (ev: MessageEvent<SitingInput>) => {
  try {
    const out = recommendSites(ev.data, (p) => self.postMessage({ type: 'progress', progress: p }));
    self.postMessage({ type: 'done', result: out });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

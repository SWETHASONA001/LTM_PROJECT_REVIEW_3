import { useCallback, useEffect, useRef, useState } from 'react';
import type { OptimizeInput, OptimizeOutput, OptimizeProgress } from '../physics/optimizer';

export type OptimizerState =
  | { status: 'idle' }
  | { status: 'running'; progress: OptimizeProgress[]; startedAt: number }
  | { status: 'done'; result: OptimizeOutput; progress: OptimizeProgress[]; durationMs: number }
  | { status: 'error'; message: string }
  | { status: 'cancelled' };

/** Runs the layout optimiser in a Web Worker so the UI stays responsive. */
export function useOptimizer() {
  const worker = useRef<Worker | null>(null);
  const [state, setState] = useState<OptimizerState>({ status: 'idle' });

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (input: OptimizeInput): Promise<OptimizeOutput> => {
      stop();
      const w = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      const startedAt = performance.now();
      const progress: OptimizeProgress[] = [];
      setState({ status: 'running', progress: [], startedAt });
      return new Promise((resolve, reject) => {
        w.onmessage = (ev) => {
          const msg = ev.data;
          if (msg.type === 'progress') {
            progress.push(msg.progress);
            setState({ status: 'running', progress: [...progress], startedAt });
          } else if (msg.type === 'done') {
            setState({ status: 'done', result: msg.result, progress, durationMs: performance.now() - startedAt });
            stop();
            resolve(msg.result);
          } else if (msg.type === 'error') {
            setState({ status: 'error', message: msg.message });
            stop();
            reject(new Error(msg.message));
          }
        };
        w.onerror = (e) => {
          setState({ status: 'error', message: e.message || 'Worker failed' });
          stop();
          reject(new Error(e.message));
        };
        w.postMessage(input);
      });
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setState({ status: 'cancelled' });
  }, [stop]);

  return { state, run, cancel, reset: () => setState({ status: 'idle' }) };
}

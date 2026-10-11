import { useCallback, useEffect, useState } from 'react';
import type { DatasetMap, DatasetName } from '../data/types';

/**
 * Loads the static, provenance-tagged extracts in /public/data.
 * They are produced from the real repository datasets by
 * scripts/build_frontend_data.py — never hand-written fixtures.
 */
const cache = new Map<DatasetName, Promise<unknown>>();

export function loadDataset<K extends DatasetName>(name: K): Promise<DatasetMap[K]> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${name}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`Dataset "${name}" could not be loaded (HTTP ${res.status}).`);
      return res.json();
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<DatasetMap[K]>;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

export function useDataset<K extends DatasetName>(name: K): AsyncState<DatasetMap[K]> {
  const [state, setState] = useState<{ data?: DatasetMap[K]; error?: Error; loading: boolean }>({
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    loadDataset(name)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error: Error) => alive && setState({ error, loading: false }));
    return () => {
      alive = false;
    };
  }, [name, nonce]);

  const reload = useCallback(() => {
    cache.delete(name);
    setNonce((n) => n + 1);
  }, [name]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}

/** Load several datasets at once; resolves when all are available. */
export function useDatasets<K extends DatasetName>(names: K[]): AsyncState<{ [P in K]: DatasetMap[P] }> {
  const key = names.join('|');
  const [state, setState] = useState<{ data?: { [P in K]: DatasetMap[P] }; error?: Error; loading: boolean }>({
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const list = key.split('|') as K[];
    setState((s) => ({ ...s, loading: true, error: undefined }));
    Promise.all(list.map((n) => loadDataset(n)))
      .then((values) => {
        if (!alive) return;
        const out = {} as { [P in K]: DatasetMap[P] };
        list.forEach((n, i) => ((out as Record<string, unknown>)[n] = values[i]));
        setState({ data: out, loading: false });
      })
      .catch((error: Error) => alive && setState({ error, loading: false }));
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    key.split('|').forEach((n) => cache.delete(n as DatasetName));
    setNonce((n) => n + 1);
  }, [key]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}

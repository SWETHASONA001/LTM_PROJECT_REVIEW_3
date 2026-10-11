import { useEffect, useState } from 'react';

/**
 * FastAPI backend client. The base URL comes only from VITE_API_BASE_URL
 * (build-time env). When it is empty the app runs in standalone mode:
 * static data extracts + in-browser physics. No secrets ever live here.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  if (!API_BASE) throw new ApiError('Backend not configured (VITE_API_BASE_URL is empty).', 0);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 15000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? JSON.stringify(body);
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(typeof detail === 'string' ? detail : JSON.stringify(detail), res.status);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e instanceof Error && e.name === 'AbortError' ? 'Request timed out' : 'Backend unreachable', 0);
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------- Contracts ---- */

export interface HealthResponse {
  status: 'ok';
  version: string;
  capabilities: {
    floris: boolean;
    floris_version?: string | null;
    llm: boolean;
    llm_model?: string | null;
    datasets: boolean;
    cnn_pinn?: boolean;
    forecaster?: boolean;
  };
}

export interface FlorisRequest {
  site: 'onshore' | 'offshore';
  x: number[];
  y: number[];
  wind_direction: number;
  wind_speed: number;
  turbulence_intensity: number;
  turbine: { rotor_diameter: number; hub_height: number; ws: number[]; power_kw: number[]; ct: number[] };
}

export interface FlorisResponse {
  engine: string;
  turbine_power_kw: number[];
  turbine_ws: number[];
  farm_power_kw: number;
  provenance: 'physics';
}

export interface CopilotRequest {
  conversation_id: string;
  message: string;
  context: Record<string, unknown>;
}

export interface CopilotResponse {
  answer: string;
  references: { label: string; kind: string; detail?: string }[];
  tool_calls: { name: string; summary: string }[];
  instruction?: {
    turbine: string;
    change: string;
    reason: string;
    expected_effect: string;
    constraints: string[];
    confidence: string;
    source: string;
  } | null;
  model?: string;
}

export interface CnnPredictResponse {
  power_kw: number;
  interval_kw: [number, number];
  physics_cap_kw: number;
  air_density: number;
}

export interface ForecastResponse {
  issue_time: string;
  observed_now_kw: number;
  forecasts: { horizon_h: number; target_time: string; forecast_kw: number; interval_kw: [number, number]; observed_kw: number | null }[];
}

export interface ServerOptimizeRequest {
  x: number[];
  y: number[];
  movable: boolean[];
  turbine: FlorisRequest['turbine'];
  cases: { dirs: number[]; speeds: number[]; probs: number[] };
  turbulence_intensity: number;
  min_spacing_d: number;
  boundary_width: number;
  boundary_height: number;
  max_evaluations: number;
  initial_step_d: number;
  seed: number;
}

export interface ServerOptimizeResponse {
  engine: string;
  method: string;
  x: number[];
  y: number[];
  start_aep_mwh: number;
  best_aep_mwh: number;
  evaluations: number;
  accepted_moves: number;
  terminated_by: string;
  history: { evaluations: number; aep: number }[];
  seconds: number;
}

export interface HydrogenAllocateResponse {
  h2_kg: number;
  available_mwh: number;
  to_electrolyzer_mwh: number;
  curtailed_mwh: number;
  balance_error_mwh: number;
}

export const backend = {
  health: () => request<HealthResponse>('/api/health', { timeoutMs: 4000 }),
  floris: (body: FlorisRequest) => request<FlorisResponse>('/api/floris/simulate', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000 }),
  copilot: (body: CopilotRequest) => request<CopilotResponse>('/api/copilot/chat', { method: 'POST', body: JSON.stringify(body), timeoutMs: 180000 }),
  cnnPredict: (body: { wind_speed: number; wind_direction: number; temperature: number }) =>
    request<CnnPredictResponse>('/api/models/cnn-pinn/predict', { method: 'POST', body: JSON.stringify(body) }),
  forecast: (issue_time: string) => request<ForecastResponse>('/api/forecast', { method: 'POST', body: JSON.stringify({ issue_time }), timeoutMs: 60000 }),
  optimize: (body: ServerOptimizeRequest) => request<ServerOptimizeResponse>('/api/optimize', { method: 'POST', body: JSON.stringify(body), timeoutMs: 600000 }),
  hydrogen: (body: { available_kw: number[]; stack_curve: { kw: number[]; kg_per_h: number[] }; plant: { modules: number; staging: string; storage_kwh: number; storage_kw: number; round_trip_eff: number } }) =>
    request<HydrogenAllocateResponse>('/api/hydrogen/allocate', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60000 }),
};

export type BackendStatus =
  | { state: 'standalone' }
  | { state: 'checking' }
  | { state: 'online'; health: HealthResponse }
  | { state: 'offline'; error: string };

let statusPromise: Promise<BackendStatus> | null = null;

export function checkBackend(force = false): Promise<BackendStatus> {
  if (!API_BASE) return Promise.resolve({ state: 'standalone' });
  if (!statusPromise || force) {
    statusPromise = backend
      .health()
      .then((health): BackendStatus => ({ state: 'online', health }))
      .catch((e: Error): BackendStatus => ({ state: 'offline', error: e.message }));
  }
  return statusPromise;
}

export function useBackendStatus(): [BackendStatus, () => void] {
  const [status, setStatus] = useState<BackendStatus>(API_BASE ? { state: 'checking' } : { state: 'standalone' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    if (nonce > 0) setStatus({ state: 'checking' });
    checkBackend(nonce > 0).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [nonce]);
  return [status, () => setNonce((n) => n + 1)];
}

/**
 * Typed contracts for the static data extracts produced by
 * scripts/build_frontend_data.py and (later) the FastAPI backend.
 */

export type ProvenanceKind =
  | 'observed'
  | 'processed'
  | 'predicted'
  | 'physics'
  | 'simulated'
  | 'optimized'
  | 'assumption';

export interface ProvenanceBlock {
  kind: ProvenanceKind;
  source?: string;
  method?: string;
  generatedAt?: string;
}

export type Nullable = number | null;

export interface Metrics {
  mae: number;
  rmse: number;
  r2: number | null;
  bias: number;
  n: number;
}

export interface Manifest {
  generatedAt: string;
  generator: string;
  datasets: {
    id: string;
    name: string;
    path: string;
    bytes: number;
    kind: ProvenanceKind;
    format: string;
    notes: string;
  }[];
}

export interface TurbineStat {
  id: string;
  records: number;
  start: string;
  end: string;
  meanPowerKw: number;
  maxPowerKw: number;
  meanWindSpeed: number;
  energyMWh: number;
  capacityFactor: number;
  zeroOrNegativePowerShare: number;
  missing: Record<string, number>;
}

export interface WindSummary {
  provenance: ProvenanceBlock;
  site: { name: string; country: string; coordinatesAvailable: boolean };
  turbines: string[];
  rawRows: number;
  duplicateKeyRows: number;
  columnsInFile: number;
  emptyColumns: string[];
  timeRange: { start: string; end: string };
  samplingSeconds: number;
  channels: { key: string; label: string; unit: string; missingShare: number }[];
  turbineStats: TurbineStat[];
  monthly: { turbine: string; month: string; energyMWh: number; coverage: number }[];
  ratedPowerKwObserved: number;
  tiMedian: number;
  powerCurve: {
    provenance: ProvenanceBlock;
    ws: number[];
    median: Nullable[];
    mean: Nullable[];
    p10: Nullable[];
    p90: Nullable[];
    count: number[];
    engineering: number[];
    engineeringMethod: string;
    perTurbine: Record<string, { ws: number[]; p: Nullable[] }>;
  };
  resource: WindResource;
  rose: { sectors: number; speedBins: string[]; percent: number[][] };
}

export interface WindResource {
  provenance: ProvenanceBlock;
  sectors: number;
  speedEdges: number[];
  /** freq[sector][speedBin], sums to 1 */
  freq: number[][];
}

export interface HourlyTurbineSeries {
  P: Nullable[];
  Ws: Nullable[];
  Wa: Nullable[];
  Rs: Nullable[];
  Ba: Nullable[];
  Ot: Nullable[];
  Ya: Nullable[];
  n: number[];
}

export interface WindHourly {
  provenance: ProvenanceBlock;
  start: string;
  stepHours: number;
  length: number;
  fields: Record<string, string>;
  turbines: Record<string, HourlyTurbineSeries>;
}

export interface ModelCard {
  id: string;
  name: string;
  family: string;
  status: 'trained' | 'reference';
  provenance: ProvenanceKind;
  description: string;
  metrics: Metrics;
  interval?: { method: string; nominal: number; testCoverage: number };
}

export interface ModelsReport {
  generatedAt: string;
  split: {
    method: string;
    trainEnd: string;
    testStart: string;
    trainRows: number;
    testRows: number;
    target: string;
    features: string[];
  };
  models: ModelCard[];
  notImplemented: { id: string; name: string; reason: string }[];
  perTurbine: Record<string, { fleetCurve: Metrics; turbineCurve: Metrics }>;
  residualHistogram: { edges: number[]; counts: number[] };
  residualByWs: { ws: number[]; mean: Nullable[]; std: Nullable[]; count: number[] };
  scatter: { ws: Nullable[]; observed: Nullable[]; predicted: Nullable[] };
  curve: { ws: number[]; mean: Nullable[]; q05: Nullable[]; q95: Nullable[] };
  testWeek: {
    turbine: string;
    t: string[];
    observed: Nullable[];
    predicted: Nullable[];
    lo: Nullable[];
    hi: Nullable[];
    ws: Nullable[];
  };
}

export interface AnomalyEvent {
  turbine: string;
  start: string;
  end: string;
  durationH: number;
  meanWs: number;
  meanPowerKw: number;
  expectedPowerKw: number;
  deficitMWh: number;
  meanPitch: number | null;
  severity: 'low' | 'medium' | 'high';
}

export interface AnomalyReport {
  provenance: ProvenanceBlock;
  flaggedRecordShare: number;
  events: AnomalyEvent[];
}

export interface ForecastReport {
  provenance: ProvenanceBlock;
  split: { trainEnd: string; testHours: number };
  horizons: { horizonH: number; persistence: Metrics; climatology: Metrics }[];
  window: { t: string[]; observed: Nullable[]; persistence6h: Nullable[]; climatology: Nullable[] };
}

export interface HydroSite {
  code: string;
  name: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
  records: number;
  medianStepS: number | null;
  meanDepthM: number;
  binHeightsM: number[];
  speed: { mean: number; p50: number; p90: number; max: number };
  floodShare: number;
  aboveCutInShare: number;
  meanPowerDensityWm2: number;
  meanAlpha: number | null;
  labelCounts: number[];
  speedHist: { edges: number[]; counts: number[] };
  meanProfileFlood: Nullable[];
  meanProfileEbb: Nullable[];
  source: string;
}

export interface HydroSites {
  provenance: ProvenanceBlock;
  labels: string[];
  rhoSea: number;
  cutInMs: number;
  sites: HydroSite[];
}

export interface HydroSeries {
  provenance: ProvenanceBlock;
  series: Record<string, { t0: string; dtS: number[]; u: Nullable[]; depth: Nullable[]; stride: number }>;
}

export interface ElectrolyzerExperiment {
  id: string;
  group: 'wind-emulation' | 'historical-wind' | 'simulated-tidal';
  sourceNote: string;
  file: string;
  rows: number;
  meanSourceKw: number | null;
  meanStackKw: number;
  maxStackKw: number;
  meanFlowKgH: number;
  secKwhPerKg: number | null;
}

export interface ElectrolyzerReport {
  provenance: ProvenanceBlock;
  experiments: ElectrolyzerExperiment[];
  stackCurve: { provenance: string; stackKw: number[]; flowKgH: number[]; count: number[] };
  linearFit: { slopeKgHPerKw: number; interceptKgH: number; validFromKw: number; metrics: Metrics };
  observedRangeKw: { min: number; max: number };
  overallSecKwhPerKg: number;
  samples: Record<string, { src: Nullable[]; psu: Nullable[]; flow: Nullable[]; strideRows: number }>;
}

export interface DatasetMap {
  manifest: Manifest;
  wind_summary: WindSummary;
  wind_hourly: WindHourly;
  models: ModelsReport;
  anomalies: AnomalyReport;
  forecast: ForecastReport;
  hydro_sites: HydroSites;
  hydro_series: HydroSeries;
  electrolyzer: ElectrolyzerReport;
}

export type DatasetName = keyof DatasetMap;

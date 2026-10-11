/**
 * AeroHydro Engineering Copilot — local tool mode.
 *
 * A deterministic intent router over real project tools (datasets, wake model,
 * optimizer results, hydrogen dispatch). It is NOT a language model: it only
 * answers what its tools can compute and says so when data is missing.
 * When a backend LLM is configured, the UI sends questions there instead
 * (see services/api.ts → backend.copilot).
 */
import type { CopilotMessage, CopilotReference, OperatorInstruction } from '../store/appStores';
import { useSiteStore, type SiteId } from '../store/siteStore';
import { loadDataset } from '../services/dataService';
import { annualEnergy } from '../physics/aep';
import { checkConstraints, pairwiseMin } from '../physics/constraints';
import { DEFAULT_HYDRO, sweptArea } from '../physics/hydro';
import { stackModelFromReport } from '../physics/hydrogen';
import { interp, offshoreModel, onshoreModel } from '../physics/turbines';
import { solveFarm, WAKE_MODEL_LABEL } from '../physics/wake';
import { casesFromResource, weibullCases } from '../physics/aep';
import { compass, date, energy, fmt, mass, pct, power, signedPct } from './format';
import { hourIndexToDate, observedConditions } from './engineering';
import { evaluateLayout, explainDifference } from './scenarioMetrics';
import { decompose, modeledWindSeries } from './hydrogenScenario';

export type Answer = Omit<CopilotMessage, 'id' | 'createdAt' | 'role'> & { context?: { turbine?: string; site?: SiteId } };

const TURBINE_RE = /\b(R80(?:711|721|736|790))\b|\b(P\d{2}|OF\d{2})\b/i;

function mentionedTurbine(q: string): string | undefined {
  const m = q.match(TURBINE_RE);
  return m ? (m[1] ?? m[2]).toUpperCase() : undefined;
}

function mentionedSite(q: string): SiteId | undefined {
  if (/offshore|ocean|sea\b/i.test(q)) return 'offshore';
  if (/onshore|haute borne|land/i.test(q)) return 'onshore';
  return undefined;
}

async function engineeringFor(site: SiteId) {
  const st = useSiteStore.getState().sites[site];
  if (site === 'offshore') {
    return { st, model: offshoreModel(), cases: weibullCases({ ...st.offshoreResource, sectors: 12, speedStep: 1 }) };
  }
  const summary = await loadDataset('wind_summary');
  return { st, model: onshoreModel(summary), cases: casesFromResource(summary.resource, 1), summary };
}

const ref = (label: string, kind: string, detail?: string, href?: string): CopilotReference => ({ label, kind, detail, href });

/* ------------------------------------------------------------- tools ---- */

async function toolUnderperformance(turbine: string | undefined, q: string): Promise<Answer> {
  const report = await loadDataset('anomalies');
  if (!turbine || !/^R80/.test(turbine)) {
    return {
      content: turbine
        ? `${turbine} is a proposed planning position — it has no measurements, so under-performance cannot be assessed from data.`
        : 'Which turbine? Measured data exists only for R80711, R80721, R80736 and R80790.',
      facts: turbine ? [`${turbine} has status “proposed”; only modeled values exist for it.`] : [],
      references: [ref('anomalies.json', 'dataset')],
      tools: [{ name: 'anomaly_events', summary: 'Checked turbine against SCADA asset list' }],
    };
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = months.findIndex((m) => new RegExp(`\\b${m}`, 'i').test(q));
  let events = report.events.filter((e) => e.turbine === turbine);
  if (mi >= 0) events = events.filter((e) => new Date(e.start).getUTCMonth() === mi);
  const total = events.reduce((a, e) => a + e.deficitMWh, 0);
  const top = [...events].sort((a, b) => b.deficitMWh - a.deficitMWh).slice(0, 3);
  const feathered = events.filter((e) => (e.meanPitch ?? 0) > 20);
  const facts = [
    `${events.length} sustained under-performance event(s) for ${turbine}${mi >= 0 ? ` in ${months[mi].toUpperCase()}` : ' over the record'}, totalling ≈${energy(total, 2)} estimated deficit.`,
    ...top.map((e) => `${date(e.start, true)}: ${fmt(e.durationH, 1)} h, wind ${fmt(e.meanWs, 1)} m/s, ${fmt(e.meanPowerKw, 0)} kW observed vs ${fmt(e.expectedPowerKw, 0)} kW expected, mean pitch ${fmt(e.meanPitch, 1)}°.`),
    `${feathered.length} of ${events.length} events show mean blade pitch > 20° (feathered).`,
  ];
  return {
    content:
      events.length === 0
        ? `No sustained under-performance events were detected for ${turbine}${mi >= 0 ? ' in that month' : ''}. Lower output in that period is explained by lower wind speed according to the power-curve model.`
        : `${turbine} lost the most energy in the events below. Most large deficits coincide with feathered blades, which points to stops or curtailment rather than aerodynamic under-performance.`,
    facts,
    assumptions: ['Expected power = fleet empirical power curve at the observed nacelle wind speed.', 'Event causes are inferred from pitch; the dataset contains no alarm or status codes.'],
    recommendations: events.length ? ['Cross-check event times against the turbine event/alarm log.', 'Exclude these periods when training performance models.'] : [],
    references: [ref('anomalies.json', 'model output', report.provenance.method, '/anomalies'), ref('La Haute Borne SCADA', 'observed', 'data/raw/wind/la-haute-borne-data-2017-2020.csv')],
    tools: [{ name: 'anomaly_events', summary: `Filtered ${report.events.length} events → ${events.length}` }],
    context: { turbine, site: 'onshore' },
  };
}

async function toolCurrentWind(): Promise<Answer> {
  const h = await loadDataset('wind_hourly');
  const st = useSiteStore.getState().sites.onshore;
  const idx = st.sim.timeIndex;
  const c = observedConditions(h, idx);
  const when = hourIndexToDate(h, idx);
  if (!c) return { content: `No valid wind measurements exist at ${date(when, true)} (selected twin timestamp).`, references: [ref('wind_hourly.json', 'dataset')], tools: [{ name: 'scada_lookup', summary: `hour index ${idx}` }] };
  return {
    content: `At the selected digital-twin timestamp (${date(when, true)}), the observed wind came from ${fmt(c.windDir, 0)}° (${compass(c.windDir)}) at ${fmt(c.windSpeed, 2)} m/s.`,
    facts: [
      `Average of ${c.turbinesWithData} real turbine(s) with data in that hour (hourly circular mean of Wa_avg, mean of Ws_avg).`,
      c.farmObservedKw != null ? `Observed 4-turbine power: ${power(c.farmObservedKw)}.` : 'At least one turbine has no power record in that hour.',
    ],
    assumptions: ['“Current” means the timestamp selected on the onshore twin timeline — the dataset is historical (2017–Jan 2018); there is no live feed.'],
    references: [ref('wind_hourly.json', 'processed', 'Hourly means of 10-min SCADA records', '/twin/onshore')],
    tools: [{ name: 'scada_lookup', summary: `hour index ${idx}` }],
  };
}

async function toolWakeRanking(site: SiteId): Promise<Answer> {
  const { st, model } = await engineeringFor(site);
  const L = st.turbines;
  const r = solveFarm({ x: L.map((t) => t.x), y: L.map((t) => t.y), model, windDir: st.windDir, windSpeed: st.windSpeed, ti: st.ti });
  const ranked = L.map((t, i) => ({ t, d: r.deficit[i], p: r.powerKw[i] })).sort((a, b) => b.d - a.d);
  return {
    content: `Under the planner condition (${Math.round(st.windDir)}° ${compass(st.windDir)}, ${st.windSpeed} m/s, TI ${pct(st.ti, 0)}), the most waked ${site} turbines are ${ranked.slice(0, 3).map((x) => x.t.label).join(', ')}. Farm wake loss is ${pct(r.wakeLoss, 2)}.`,
    facts: ranked.slice(0, 5).map((x) => `${x.t.label}${x.t.status === 'real' ? ' (real)' : ''}: velocity deficit ${pct(x.d, 1)}, modeled ${power(x.p)}.`),
    assumptions: [`${WAKE_MODEL_LABEL}; single ambient TI; identical turbines.`],
    recommendations: ['Change the wind direction in the planner to see how the ranking shifts — annual effects are in the AEP comparison.'],
    references: [ref('Planner layout', 'simulated', `${L.length} turbines`, '/planner'), ref('Gaussian wake model', 'physics-derived')],
    tools: [{ name: 'wake_model.solve_farm', summary: `${L.length} turbines @ ${Math.round(st.windDir)}°` }],
    context: { site },
  };
}

async function toolMoveTurbine(site: SiteId, turbine?: string): Promise<Answer> {
  const { st, model, cases } = await engineeringFor(site);
  const L = st.turbines;
  const id = turbine ?? st.selectedId ?? L.find((t) => t.status === 'proposed')?.id;
  const i = L.findIndex((t) => t.id === id || t.label === id);
  if (i < 0) return { content: 'Select a turbine in the planner or name it (e.g. “move P07”).', tools: [] };
  const t = L[i];
  if (t.status === 'real' && st.lockReal) {
    return { content: `${t.label} is a real asset and is locked in the planner. Unlock real turbines to explore hypothetical relocations.`, facts: ['Real SCADA turbines are locked by default.'], tools: [] };
  }
  const D = model.rotorDiameter.value;
  const xs = L.map((x) => x.x);
  const ys = L.map((x) => x.y);
  const base = annualEnergy(xs, ys, model, cases, st.ti).aepMWh;
  const moves = Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    const nx = [...xs];
    const ny = [...ys];
    nx[i] += Math.sin(a) * D;
    ny[i] += Math.cos(a) * D;
    const cand = L.map((x, j) => ({ ...x, x: nx[j], y: ny[j] }));
    const viol = checkConstraints(cand, { minSpacingD: st.minSpacingD, rotorDiameter: D, boundary: st.boundary }).length;
    return { dir: k * 45, aep: annualEnergy(nx, ny, model, cases, st.ti).aepMWh, viol };
  });
  const best = [...moves].sort((a, b) => b.aep - a.aep)[0];
  const worst = [...moves].sort((a, b) => a.aep - b.aep)[0];
  return {
    content: `Moving ${t.label} by one rotor diameter (${D} m) changes modeled annual energy between ${signedPct(worst.aep / base - 1)} (toward ${compass(worst.dir)}) and ${signedPct(best.aep / base - 1)} (toward ${compass(best.dir)}).`,
    facts: moves.map((m) => `Toward ${compass(m.dir)}: AEP ${energy(m.aep, 2)} (${signedPct(m.aep / base - 1)})${m.viol ? ` — ${m.viol} constraint violation(s)` : ''}`),
    assumptions: [`Wind-rose AEP with ${cases.label}.`, WAKE_MODEL_LABEL],
    recommendations: [best.viol ? 'The best direction violates constraints — run the optimizer, which respects them.' : `Try dragging ${t.label} toward ${compass(best.dir)} in the planner, then compare against baseline.`],
    references: [ref('Planner', 'simulated', undefined, '/planner')],
    tools: [{ name: 'aep.annual_energy', summary: '9 layout evaluations' }],
    context: { turbine: t.id, site },
  };
}

async function toolSpacing(site: SiteId): Promise<Answer> {
  const { st, model } = await engineeringFor(site);
  const D = model.rotorDiameter.value;
  const v = checkConstraints(st.turbines, { minSpacingD: st.minSpacingD, rotorDiameter: D, boundary: st.boundary });
  const mp = pairwiseMin(st.turbines);
  return {
    content: `The ${site} layout uses a minimum spacing of ${st.minSpacingD}D = ${fmt(st.minSpacingD * D, 0)} m. The closest pair is ${fmt(mp.d, 0)} m (${fmt(mp.d / D, 2)}D) apart; ${v.length ? `${v.length} violation(s) exist.` : 'no constraints are violated.'}`,
    facts: [`Rotor diameter ${D} m — ${model.rotorDiameter.source}.`, `Site boundary ${st.boundary.width} × ${st.boundary.height} m.`, ...v.slice(0, 5).map((x) => x.message)],
    assumptions: ['The spacing value is a user-configured planning constraint, not a manufacturer or permit requirement (none exist in the repository).'],
    references: [ref('Planner constraints', 'assumption', undefined, '/planner')],
    tools: [{ name: 'constraints.check', summary: `${st.turbines.length} turbines` }],
    context: { site },
  };
}

async function toolCompareLayouts(site: SiteId): Promise<Answer> {
  const { st, model, cases, summary } = await engineeringFor(site);
  const eng = { model, cases, optCases: cases, summary };
  const base = evaluateLayout(st.baseline, eng, st);
  const candT = st.candidate?.turbines ?? st.turbines;
  const cand = evaluateLayout(candT, eng, st);
  const label = st.candidate ? 'optimized candidate' : 'current edit';
  const d = cand.metrics.aepMWh - base.metrics.aepMWh;
  return {
    content: `Against the baseline, the ${label} changes modeled AEP by ${signedPct(d / base.metrics.aepMWh)} (${d >= 0 ? '+' : ''}${fmt(d, 0)} MWh/yr). Annual wake loss goes from ${pct(base.metrics.wakeLossAnnual, 2)} to ${pct(cand.metrics.wakeLossAnnual, 2)}.`,
    facts: explainDifference(base.aep, cand.aep, base.metrics.nTurbines, cand.metrics.nTurbines),
    assumptions: [`${cases.label}.`, WAKE_MODEL_LABEL, '100% availability; no uncertainty band is computed for AEP.'],
    recommendations: st.candidate ? [`Optimizer: ${st.candidate.evaluations} evaluations, stopped by ${st.candidate.terminatedBy}. It is a local optimum — re-run with other seeds to test robustness.`] : ['No optimized candidate exists yet — run the optimizer in the planner.'],
    references: [ref('Baseline vs candidate', 'optimized', undefined, '/planner')],
    tools: [{ name: 'scenario.evaluate', summary: 'baseline + candidate AEP' }],
    context: { site },
  };
}

async function toolHydrogen(): Promise<Answer> {
  const [h, elec] = await Promise.all([loadDataset('wind_hourly'), loadDataset('electrolyzer')]);
  const { st, model } = await engineeringFor('onshore');
  const stack = stackModelFromReport(elec);
  const plant = { modules: 12, staging: 'optimal' as const, storageKwh: 0, storageKw: 0, roundTripEff: 0.88 };
  const baseKw = modeledWindSeries(h, st.baseline, model, st.ti);
  const candT = st.candidate?.turbines ?? st.turbines;
  const candKw = modeledWindSeries(h, candT, model, st.ti);
  const dec = decompose(baseKw, candKw, null, stack, plant);
  const layoutStep = dec.steps.find((s) => s.key === 'layout')!;
  return {
    content: `With a 12-stack plant (${fmt((12 * stack.maxKw) / 1000, 1)} MW) the ${st.candidate ? 'optimized candidate' : 'current'} layout changes modeled H₂ by ${layoutStep.delta >= 0 ? '+' : ''}${mass(layoutStep.delta)} over the ${h.length.toLocaleString()}-hour record versus the baseline layout.`,
    facts: dec.steps.map((s) => `${s.label}: ${s.key === 'base' ? mass(s.h2Kg) : `${s.delta >= 0 ? '+' : ''}${mass(s.delta)}`} — ${s.note}`),
    assumptions: ['Electrolyzer = empirical stack curve measured on the test stand; scale-out to 12 stacks is assumed.', 'Wind = observed SCADA wind each hour through the wake model.', 'No storage in this quick estimate.'],
    references: [ref('Hydrogen optimization', 'simulated', undefined, '/hydrogen'), ref('electrolyzer.json', 'observed', 'Stack curve')],
    tools: [{ name: 'hydrogen.decompose', summary: `${h.length} h × 2 layouts` }],
  };
}

async function toolHydro(): Promise<Answer> {
  const sites = await loadDataset('hydro_sites');
  const best = [...sites.sites].sort((a, b) => b.meanPowerDensityWm2 - a.meanPowerDensityWm2)[0];
  return {
    content: 'Hydrokinetic estimates use P_available = ½·ρ·A·v³ and P_electrical = min(P_rated, ½·ρ·A·v³·Cp·η), zero below the 0.75 m/s cut-in. Velocities are observed; every power value is modeled.',
    facts: [
      `v = depth-averaged principal-axis velocity from ADCP profiles at ${sites.sites.length} sites.`,
      `ρ = ${sites.rhoSea} kg/m³; default turbine D = ${DEFAULT_HYDRO.diameter} m (A = ${fmt(sweptArea(DEFAULT_HYDRO.diameter), 0)} m²), Cp = ${DEFAULT_HYDRO.cp}, η = ${DEFAULT_HYDRO.eta}, rated ${DEFAULT_HYDRO.ratedKw} kW.`,
      `Highest mean kinetic power density: ${best.code} (${best.name}) at ${fmt(best.meanPowerDensityWm2 / 1000, 2)} kW/m².`,
    ],
    assumptions: ['Cp and η constant with speed; depth-averaged rather than hub-height velocity; no blockage, wake or array effects.', 'The repository contains no hydrokinetic generator measurements.'],
    references: [ref('hydro_sites.json', 'observed', sites.provenance.method, '/hydro'), ref('README_648.txt', 'documentation')],
    tools: [{ name: 'hydro.sites', summary: `${sites.sites.length} sites` }],
  };
}

async function toolPredict(q: string): Promise<Answer> {
  const m = await loadDataset('models');
  const num = q.match(/(\d+(?:\.\d+)?)\s*m\/?s/i) ?? q.match(/at\s+(\d+(?:\.\d+)?)/i);
  const card = m.models[0];
  const facts = [`CNN-PINN: not implemented — no code or weights exist in the repository.`, `Available predictor: ${card.name} (test R² ${fmt(card.metrics.r2, 3)}, RMSE ${fmt(card.metrics.rmse, 0)} kW).`];
  if (!num) {
    return { content: 'The CNN-PINN model is not available. Give a wind speed (e.g. “predict at 9 m/s”) and I will use the trained empirical power-curve model instead.', facts, references: [ref('models.json', 'predicted', undefined, '/models')], tools: [{ name: 'model_registry', summary: 'checked availability' }] };
  }
  const v = Number(num[1]);
  const c = m.curve;
  const p = interp(c.ws, c.mean.map((x) => x ?? 0), v);
  const lo = interp(c.ws, c.q05.map((x) => x ?? 0), v);
  const hi = interp(c.ws, c.q95.map((x) => x ?? 0), v);
  return {
    content: `At ${fmt(v, 1)} m/s the fleet power-curve model predicts ${fmt(p, 0)} kW per turbine (90% interval ${fmt(lo, 0)}–${fmt(hi, 0)} kW). This is not a CNN-PINN prediction — that model does not exist yet.`,
    facts: [...facts, `Interval test coverage ${pct(card.interval?.testCoverage, 1)} (nominal 90%).`],
    assumptions: ['Single feature: nacelle wind speed. Direction, density and turbulence are not inputs.'],
    references: [ref('models.json', 'predicted', card.description, '/models')],
    tools: [{ name: 'power_curve.predict', summary: `ws=${v}` }],
  };
}

async function toolMissing(turbine?: string): Promise<Answer> {
  const w = await loadDataset('wind_summary');
  const t = turbine && w.turbineStats.find((s) => s.id === turbine);
  return {
    content: `${w.emptyColumns.length} SCADA columns are completely empty (${w.emptyColumns.join(', ')}). Core channels P_avg, Ws_avg and Wa_avg are each ${pct(w.channels.find((c) => c.key === 'P_avg')?.missingShare, 2)} missing.`,
    facts: [
      ...w.channels.map((c) => `${c.key} (${c.label}): ${pct(c.missingShare, 2)} missing`),
      ...(t ? Object.entries(t.missing).map(([k, v]) => `${turbine} ${k}: ${pct(v, 2)} missing`) : []),
      `${w.duplicateKeyRows} rows had duplicate turbine/timestamp keys (first kept).`,
      'Not in the repository at all: turbine coordinates, alarm/status logs, offshore measurements, hydrokinetic generator power, met-mast data.',
    ],
    references: [ref('wind_summary.json', 'processed', undefined, '/wind'), ref('reports/data_quality_audit.txt', 'audit')],
    tools: [{ name: 'data_quality', summary: 'channel missing shares' }],
    context: turbine ? { turbine } : undefined,
  };
}

async function toolUncertainty(): Promise<Answer> {
  const m = await loadDataset('models');
  const c = m.models[0];
  return {
    content: `The fleet power-curve prediction carries an empirical 90% interval; on held-out data it covered ${pct(c.interval?.testCoverage, 1)} of observations. Point error: MAE ${fmt(c.metrics.mae, 0)} kW, RMSE ${fmt(c.metrics.rmse, 0)} kW.`,
    facts: ['Wake-model and AEP results have no computed uncertainty band.', 'Hydrogen and hydro results inherit assumption uncertainty (Cp, η, plant scale) that is not quantified.'],
    recommendations: ['Treat layout AEP differences below ~1% as within model uncertainty until a calibrated wake model (e.g. FLORIS vs SCADA) is available.'],
    references: [ref('models.json', 'predicted', c.interval?.method, '/models')],
    tools: [{ name: 'model_registry', summary: 'interval coverage' }],
  };
}

function toolProvenance(): Answer {
  return {
    content: 'Every result is labeled by origin. Here is which tool produces what:',
    facts: [
      'Observed — SCADA (La Haute Borne), ADCP currents (14 sites), electrolyzer test-stand measurements.',
      'Processed — hourly means, power curves, wind rose, monthly energy (scripts/build_frontend_data.py).',
      'Predicted — empirical power-curve model, anomaly detector, forecast baselines (time-aware split).',
      `Physics-derived — ${WAKE_MODEL_LABEL}; kinetic power ½ρAv³.`,
      'Simulated — offshore farm, proposed turbines, hydro turbines, hydrogen plant, tidal-electrolyzer input profile.',
      'Optimized — layout candidates from the pattern-search optimizer.',
    ],
    references: [ref('Settings & data sources', 'documentation', undefined, '/settings')],
    tools: [{ name: 'provenance', summary: 'registry' }],
  };
}

async function toolInstruction(turbine?: string): Promise<Answer> {
  const report = await loadDataset('anomalies');
  const id = turbine && /^R80/.test(turbine) ? turbine : [...report.events].sort((a, b) => b.deficitMWh - a.deficitMWh)[0]?.turbine;
  if (!id) return { content: 'No turbine with supporting evidence was found.', tools: [] };
  const ev = report.events.filter((e) => e.turbine === id);
  const deficit = ev.reduce((a, e) => a + e.deficitMWh, 0);
  const feathered = ev.filter((e) => (e.meanPitch ?? 0) > 20).length;
  const instruction: OperatorInstruction = {
    turbine: id,
    change: feathered > ev.length / 2 ? 'Review pitch-system and stop/curtailment records; verify the turbine returns to normal pitch schedule after stops.' : 'Inspect power-curve conformity (anemometer calibration, yaw alignment, derate settings).',
    reason: `${ev.length} sustained under-performance events in the 2017 record, ≈${energy(deficit, 1)} estimated deficit; ${feathered} with feathered blades.`,
    expectedEffect: `If the root cause is recoverable, up to ≈${energy(deficit, 1)} of the historical deficit would not recur (upper bound, modeled).`,
    constraints: ['Manufacturer operating limits and site grid-code obligations apply.', 'Any setpoint change requires authorized operator approval via the plant control system.', 'Do not act during maintenance lock-out.'],
    confidence: 'Medium-low: cause inferred from pitch only; no alarm logs in the dataset.',
    source: 'Anomaly detector (power-curve residual) on La Haute Borne SCADA',
  };
  return {
    content: `Draft operator instruction for ${id}. This is decision support only — it has NOT been sent to or executed by any control system.`,
    instruction,
    references: [ref('anomalies.json', 'predicted', report.provenance.method, '/anomalies')],
    tools: [{ name: 'operator_instruction.draft', summary: id }],
    context: { turbine: id, site: 'onshore' },
  };
}

function toolHelp(): Answer {
  return {
    content: 'I run in local tool mode: I answer by executing the project’s data and physics tools, not a language model. I can help with:',
    facts: [
      'Turbine under-performance (e.g. “Why did R80711 generate less power in November?”)',
      'Observed wind at the twin timestamp, wake ranking, spacing constraints',
      'Effect of moving a turbine, baseline vs optimized trade-offs',
      'Hydrogen impact of a layout, hydrokinetic assumptions',
      'Model predictions (“predict at 9 m/s”), uncertainty, missing data, provenance',
      'Draft operator instructions (“prepare an instruction for R80790”) — never executed',
    ],
    tools: [],
  };
}

export async function localAnswer(question: string, ctx: { turbine?: string; site?: SiteId }): Promise<Answer> {
  const q = question.trim();
  const turbine = mentionedTurbine(q) ?? ctx.turbine;
  const site = mentionedSite(q) ?? (turbine && /^OF/.test(turbine) ? 'offshore' : ctx.site) ?? useSiteStore.getState().activeSite;
  const mode = { mode: 'local-tools' as const };
  const wrap = async (p: Promise<Answer> | Answer) => ({ ...(await p), ...mode });

  if (/instruction|operator|setpoint|recommend.*setting|prepare/i.test(q)) return wrap(toolInstruction(turbine));
  if (/why|less power|under-?perform|low(er)? (power|output)|deficit/i.test(q) && (turbine || /turbine|\bit\b/i.test(q))) return wrap(toolUnderperformance(turbine, q));
  if (/hydrogen|\bh2\b|electroly/i.test(q)) return wrap(toolHydrogen());
  if (/hydro|tidal|kinetic|current speed/i.test(q)) return wrap(toolHydro());
  if (/move|moving|relocat|shift/i.test(q)) return wrap(toolMoveTurbine(site, turbine));
  if (/spacing|distance between|minimum distance/i.test(q)) return wrap(toolSpacing(site));
  if (/candidate|baseline|optimi[sz]|trade-?off|better layout|which layout/i.test(q)) return wrap(toolCompareLayouts(site));
  if (/wake/i.test(q)) return wrap(toolWakeRanking(site));
  if (/wind direction|current wind|wind (speed|now)/i.test(q)) return wrap(toolCurrentWind());
  if (/uncertain|confiden|interval|error bar/i.test(q)) return wrap(toolUncertainty());
  if (/predict|cnn|pinn|forecast/i.test(q)) return wrap(toolPredict(q));
  if (/missing|gap|data quality|unavailable|measurements/i.test(q)) return wrap(toolMissing(turbine));
  if (/which model|provenance|source|generated|where .* come/i.test(q)) return wrap(toolProvenance());
  if (turbine && /^R80/.test(turbine)) return wrap(toolUnderperformance(turbine, q));
  return wrap(toolHelp());
}

export const SUGGESTED_QUESTIONS = [
  'Why did turbine R80711 generate less power than expected?',
  'What is the current wind direction in the selected dataset?',
  'Which turbines experience the strongest modeled wake effects?',
  'How does moving P07 affect the simulated farm energy?',
  'What minimum spacing constraint applies to this layout?',
  'Explain the trade-offs between the baseline and optimized scenario.',
  'How could a layout change affect modeled hydrogen production?',
  'What are the assumptions behind the hydrokinetic power estimate?',
  'What does the model predict at 9 m/s?',
  'Which measurements are missing?',
  'How uncertain is this prediction?',
  'Prepare an operator instruction for R80790.',
];

import type { ProvenanceKind } from '../data/types';

export const PROVENANCE: Record<ProvenanceKind, { label: string; color: string; bg: string; description: string }> = {
  observed: {
    label: 'Observed',
    color: 'var(--color-prov-observed)',
    bg: '#e8eefc',
    description: 'Directly supported by real source records (SCADA, ADCP, electrolyzer test-stand measurements).',
  },
  processed: {
    label: 'Processed',
    color: 'var(--color-prov-processed)',
    bg: '#e3f2f0',
    description: 'Transformed or aggregated from observed records (e.g. hourly means, binned power curves).',
  },
  predicted: {
    label: 'Predicted',
    color: 'var(--color-prov-predicted)',
    bg: '#f0eafc',
    description: 'Produced by a trained predictive model evaluated on held-out data.',
  },
  physics: {
    label: 'Physics-derived',
    color: 'var(--color-prov-physics)',
    bg: '#e4f1f8',
    description: 'Calculated by a physical model (Gaussian wake model, kinetic-power relation).',
  },
  simulated: {
    label: 'Simulated',
    color: 'var(--color-prov-simulated)',
    bg: '#fbf0e0',
    description: 'Generated from a simulation, hypothetical scenario, assumed resource or proposed asset.',
  },
  optimized: {
    label: 'Optimized',
    color: 'var(--color-prov-optimized)',
    bg: '#e1f3ec',
    description: 'Produced by an optimisation algorithm run on a physics or data-driven model.',
  },
  assumption: {
    label: 'Assumption',
    color: 'var(--color-prov-assumption)',
    bg: '#eef1f4',
    description: 'A user-configured or literature value, not derived from repository data.',
  },
};

/**
 * Programme Dataset Registry
 *
 * Maps high-level programme identifiers used in the Setup panel
 * to backend dataset folders hosted under defense-scheduler/data/input.
 */

export interface ProgrammeDataset {
  datasetId: string;
  period: string;
  description: string;
}

export interface ProgrammeDatasetEntry {
  key: string;
  dataset: ProgrammeDataset;
}

export const programmeDatasets: Record<string, ProgrammeDataset> = {
  'ma-ir-cs': {
    datasetId: 'sample',
    period: 'Fall 2025',
    description: 'Sample CS Master thesis defenses (3 events)',
  },
  'ma-ir-cs:intermediate': {
    datasetId: 'intermediate_2026',
    period: 'Spring 2026',
    description: 'Intermediate presentations 2026 (VR lab)',
  },
  'ma-ir-ti': {
    datasetId: 'apitest',
    period: 'Pilot dataset',
    description: 'Apitest dataset with synthetic availabilities',
  },
  'ma-eng-ti': {
    datasetId: 'apitest_manual',
    period: 'Pilot dataset',
    description: 'Manual apitest dataset for engineering technology',
  },
  'ma-eng-digital-hum': {
    datasetId: 'apitest_manual',
    period: 'September 2025',
    description: 'Digital humanities defenses (shared dataset)',
  },
};

export function hasProgrammeData(programmeId: string): boolean {
  return programmeId in programmeDatasets;
}

export function getProgrammeDatasetInfo(programmeId: string): ProgrammeDataset | null {
  return programmeDatasets[programmeId] || null;
}

export function getAllProgrammeDatasets(programmeId: string): ProgrammeDatasetEntry[] {
  const results: ProgrammeDatasetEntry[] = [];

  if (programmeId in programmeDatasets) {
    results.push({
      key: programmeId,
      dataset: programmeDatasets[programmeId],
    });
  }

  Object.keys(programmeDatasets).forEach(key => {
    if (key.startsWith(`${programmeId}:`) && key !== programmeId) {
      results.push({
        key,
        dataset: programmeDatasets[key],
      });
    }
  });

  return results;
}

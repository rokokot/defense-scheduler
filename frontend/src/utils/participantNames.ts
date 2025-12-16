export const splitParticipantNames = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split('|')
    .map(name => name.trim())
    .filter(name => name.length > 0);
};

export const formatParticipantNames = (value?: string | null): string => {
  return splitParticipantNames(value).join(', ');
};

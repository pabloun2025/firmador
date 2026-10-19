// Ties keep the older record; an empty podium slot accepts any positive score.
export function qualifiesForPodium(score: number, records: readonly { score: number }[]) {
  return Number.isInteger(score) && score > 0 && (records.length < 3 || score > Math.min(...records.map(record => record.score)));
}

import { expect, it } from 'vitest';
import { qualifiesForPodium } from '../src/lib/high-score';
it('asks for a name only for positive results that can enter the podium', () => {
  const podium = [{score:12},{score:8},{score:5}];
  expect(qualifiesForPodium(4,podium)).toBe(false);
  expect(qualifiesForPodium(5,podium)).toBe(false); // earlier record wins ties
  expect(qualifiesForPodium(6,podium)).toBe(true);
  expect(qualifiesForPodium(1,[])).toBe(true);
  expect(qualifiesForPodium(1,[{score:20}])).toBe(true);
  for(const score of [0,-1,NaN,Infinity,1.2]) expect(qualifiesForPodium(score,[])).toBe(false);
});

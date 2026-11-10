import { randomInt } from 'node:crypto';

export const RULES = Object.freeze({
  version: 'exclusive-house-v1',
  rooms: [30, 60, 180, 300],
  lockSeconds: 5,
  welcomePoints: 10000,
  multipliers: [1, 5, 10, 20, 50, 100],
  returns: { GREEN: 2, RED: 2, VIOLET: 4.5, BIG: 1.9, SMALL: 1.9, NUMBER: 9 },
});
export const choices = ['GREEN', 'VIOLET', 'RED', ...Array.from({ length: 10 }, (_, n) => String(n)), 'BIG', 'SMALL'];
export function colour(n) { return n === 0 || n === 5 ? 'VIOLET' : n % 2 ? 'GREEN' : 'RED'; }
export function payout(selection, stake, result) {
  const wins = selection === colour(result) || selection === String(result)
    || selection === (result < 5 ? 'SMALL' : 'BIG');
  if (!wins) return 0;
  const rate = RULES.returns[selection] ?? RULES.returns.NUMBER;
  return Math.floor(stake * Math.round(rate * 10) / 10);
}
export function chooseResult(bets, pick = randomInt) {
  const payouts = Array.from({ length: 10 }, (_, n) => bets.reduce((sum, b) => sum + payout(b.selection, b.stake, n), 0));
  const minimum = Math.min(...payouts);
  const total = bets.reduce((sum, b) => sum + b.stake, 0);
  if (!Number.isSafeInteger(total) || payouts.some(value => !Number.isSafeInteger(value))) throw new Error('Round point totals exceed the supported accounting range.');
  const tied = payouts.flatMap((value, n) => value === minimum ? [n] : []);
  const result = tied[pick(tied.length)];
  return { result, payouts, total, returned: minimum, tied };
}
export function roundAt(room, now = Date.now()) {
  if (!RULES.rooms.includes(room)) throw new Error('Choose a valid room.');
  const start = Math.floor(now / (room * 1000)) * room * 1000;
  return { id: `${room}-${start}`, room, start, end: start + room * 1000, lock: start + (room - RULES.lockSeconds) * 1000 };
}
export function validateBet(input, previous = []) {
  if (!input || !choices.includes(input.selection)) throw new Error('Choose a colour, number, Big or Small.');
  if (!Number.isInteger(input.base) || input.base < 1 || input.base > 1000 || !RULES.multipliers.includes(input.multiplier)) throw new Error('Use a whole-point stake from 1 to 1,000 and an available multiplier.');
  const points = input.base * input.multiplier;
  if (points > 10000) throw new Error('The maximum stake is 10,000 points per prediction.');
  const selected = new Set([...previous.map(b => b.selection), input.selection]);
  if (selected.has('BIG') && selected.has('SMALL')) throw new Error('Big and Small cannot be combined in the same round.');
  if (selected.has('RED') && selected.has('GREEN')) throw new Error('Red and Green cannot be combined in the same round.');
  if ([...selected].filter(s => /^\d$/.test(s)).length > 7) throw new Error('Choose at most seven different numbers in one round.');
  return points * 100;
}

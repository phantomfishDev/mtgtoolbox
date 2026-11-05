import { describe, expect, it } from 'vitest';
import {
  compareCollectorNumbers,
  frontName,
  isBasicLand,
  normalizeName,
} from '../src/cards/identity.js';
import { card } from './helpers.js';

describe('name and number normalisation', () => {
  it('folds case and the curly apostrophe', () => {
    expect(normalizeName(' Praetors’ Voice ')).toBe("praetors' voice");
  });

  it('takes the front face of a double-faced name', () => {
    expect(frontName('Malakir Rebirth // Malakir Mire')).toBe('malakir rebirth');
    expect(frontName('Sol Ring')).toBe('sol ring');
  });

  it('sorts collector numbers numerically, not as strings', () => {
    expect(compareCollectorNumbers('9', '10')).toBeLessThan(0);
    expect(compareCollectorNumbers('123a', '123b')).toBeLessThan(0);
  });
});

describe('isBasicLand', () => {
  it('recognises basics, snow basics and Wastes', () => {
    expect(isBasicLand(card({ type_line: 'Basic Land — Swamp' }))).toBe(true);
    expect(isBasicLand(card({ type_line: 'Basic Snow Land — Forest' }))).toBe(true);
    expect(isBasicLand(card({ type_line: 'Basic Land' }))).toBe(true);
  });

  it('does not treat nonbasic lands as basics', () => {
    expect(isBasicLand(card({ type_line: 'Land — Island Swamp' }))).toBe(false);
    expect(isBasicLand(card({ type_line: 'Legendary Land' }))).toBe(false);
  });
});

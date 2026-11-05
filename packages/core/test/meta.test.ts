import { describe, expect, it } from 'vitest';
import { parseDeckMeta } from '../src/decklist/meta.js';

describe('parseDeckMeta', () => {
  it('reads an owner directive out of the leading comments', () => {
    const { owner, note } = parseDeckMeta('# Owner: Sam\n# Gruul apes.\n\n1 Sol Ring\n');
    expect(owner).toBe('Sam');
    expect(note).toBe('Gruul apes.');
  });

  it('accepts the key in any case', () => {
    expect(parseDeckMeta('# owner: Jill\n').owner).toBe('Jill');
    expect(parseDeckMeta('#OWNER:  Jill  \n').owner).toBe('Jill');
  });

  it('leaves the owner null when the file does not say', () => {
    const { owner, note } = parseDeckMeta('# Just a deck.\n\n1 Sol Ring\n');
    expect(owner).toBeNull();
    expect(note).toBe('Just a deck.');
  });

  it('keeps prose that merely mentions an owner mid-sentence', () => {
    // This deck's note credits the Archidekt list's author, which is not a
    // claim about whose deck it is.
    const text = '# Kibo — imported from\n# https://archidekt.com/d/1 (owner: swebb).\n';
    const { owner, note } = parseDeckMeta(text);
    expect(owner).toBeNull();
    expect(note).toContain('(owner: swebb)');
  });

  it('ignores a directive below the leading block', () => {
    const text = '# A deck.\n\n1 Sol Ring\n# Owner: not-a-deck-owner\n';
    expect(parseDeckMeta(text).owner).toBeNull();
  });

  it('ignores unknown keys, leaving them in the note', () => {
    const { owner, note } = parseDeckMeta('# Bracket: 3\n');
    expect(owner).toBeNull();
    expect(note).toBe('Bracket: 3');
  });

  it('takes the last owner when the block names more than one', () => {
    expect(parseDeckMeta('# Owner: Sam\n# Owner: Jill\n').owner).toBe('Jill');
  });

  it('treats an empty value as unset', () => {
    expect(parseDeckMeta('# Owner:   \n# A deck.\n').owner).toBeNull();
  });

  it('returns a null note when the file opens with no comments', () => {
    expect(parseDeckMeta('1 Sol Ring\n')).toEqual({ owner: null, note: null });
  });
});

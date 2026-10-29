import { describe, expect, it } from 'vitest';

import { parseRosterCsv } from './rosterCsv';

describe('parseRosterCsv', () => {
  it('reads a plain one-email-per-line file', () => {
    expect(parseRosterCsv('ada@example.edu\nGrace@Example.edu\n\n')).toEqual({
      emails: ['ada@example.edu', 'grace@example.edu'],
      skipped: [],
    });
  });

  it('reads only the Email column when a header is present', () => {
    const csv = [
      'First Name,Last Name,Email Address,Notes',
      'Ada,Lovelace,ada@example.edu,"likes ada@other.edu"',
      '"Hopper, Grace",,grace@example.edu,',
      'No,Email,,',
    ].join('\r\n');

    expect(parseRosterCsv(csv)).toEqual({
      emails: ['ada@example.edu', 'grace@example.edu'],
      skipped: ['No, Email, , '],
    });
  });

  it('handles semicolon-delimited exports', () => {
    expect(parseRosterCsv('name;email\nAda;ada@example.edu')).toEqual({
      emails: ['ada@example.edu'],
      skipped: [],
    });
  });

  it('strips a UTF-8 BOM from the first cell', () => {
    expect(parseRosterCsv(String.fromCharCode(0xfeff) + 'ada@example.edu\ngrace@example.edu')).toEqual({
      emails: ['ada@example.edu', 'grace@example.edu'],
      skipped: [],
    });
  });

  it('de-duplicates case-insensitively', () => {
    expect(parseRosterCsv('a@example.edu\nA@EXAMPLE.edu').emails).toEqual(['a@example.edu']);
  });

  it('reports headerless rows without an email as skipped', () => {
    expect(parseRosterCsv('a@example.edu\njust a name')).toEqual({
      emails: ['a@example.edu'],
      skipped: ['just a name'],
    });
  });
});

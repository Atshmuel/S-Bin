import test from 'node:test';
import assert from 'node:assert/strict';
import { csvField, csvRow } from '../utils/csv.js';

test('csvField leaves plain values as they are and empties null', () => {
    assert.equal(csvField('bin 1'), 'bin 1');
    assert.equal(csvField(42), '42');
    assert.equal(csvField(-3.5), '-3.5');
    assert.equal(csvField(null), '');
    assert.equal(csvField(undefined), '');
});

test('csvField quotes commas, quotes and line breaks', () => {
    assert.equal(csvField('a,b'), '"a,b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField('a\nb'), '"a\nb"');
});

test('csvField writes a date as ISO and keeps a spreadsheet from running a formula', () => {
    assert.equal(csvField(new Date('2026-11-06T05:00:00Z')), '2026-11-06T05:00:00.000Z');
    assert.equal(csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvField('+1'), "'+1");
});

test('csvRow joins the fields and ends the line', () => {
    assert.equal(csvRow(['a', 1, null, 'x,y']), 'a,1,,"x,y"\r\n');
});

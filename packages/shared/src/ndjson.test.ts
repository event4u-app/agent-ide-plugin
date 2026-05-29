import { describe, expect, it } from 'vitest';
import type { Envelope } from '@event4u-agent/protocol';
import { NdjsonParser, encodeEnvelope } from './ndjson.js';

const env = (over: Partial<Envelope> = {}): Envelope => ({
  messageId: 'm1',
  messageType: 'ping',
  data: {},
  done: true,
  ...over,
});

describe('encodeEnvelope', () => {
  it('appends exactly one trailing newline', () => {
    const line = encodeEnvelope(env());
    expect(line.endsWith('\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1);
  });
});

describe('NdjsonParser', () => {
  it('emits one envelope per complete line', () => {
    const seen: Envelope[] = [];
    const parser = new NdjsonParser((e) => seen.push(e));
    parser.push(encodeEnvelope(env({ messageId: 'a' })));
    parser.push(encodeEnvelope(env({ messageId: 'b' })));
    expect(seen.map((e) => e.messageId)).toEqual(['a', 'b']);
  });

  it('reassembles a line split across chunks', () => {
    const seen: Envelope[] = [];
    const parser = new NdjsonParser((e) => seen.push(e));
    const line = encodeEnvelope(env({ messageId: 'split' }));
    const mid = Math.floor(line.length / 2);
    parser.push(line.slice(0, mid));
    expect(seen).toHaveLength(0);
    parser.push(line.slice(mid));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.messageId).toBe('split');
  });

  it('routes a malformed line to onError without throwing', () => {
    const seen: Envelope[] = [];
    const errors: string[] = [];
    const parser = new NdjsonParser(
      (e) => seen.push(e),
      (line) => errors.push(line),
    );
    parser.push('{not json}\n');
    parser.push(encodeEnvelope(env({ messageId: 'ok' })));
    expect(errors).toHaveLength(1);
    expect(seen.map((e) => e.messageId)).toEqual(['ok']);
  });

  it('ignores blank lines', () => {
    const seen: Envelope[] = [];
    const parser = new NdjsonParser((e) => seen.push(e));
    parser.push('\n\n');
    expect(seen).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  EchoRequestSchema,
  EchoResponseSchema,
  EnvelopeSchema,
  MethodNameSchema,
  Methods,
  PingResponseSchema,
} from './schema.js';

describe('EnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    const parsed = EnvelopeSchema.parse({
      messageId: 'abc',
      messageType: 'ping',
      data: {},
      done: true,
    });
    expect(parsed.messageId).toBe('abc');
  });

  it('rejects an empty messageId', () => {
    expect(() =>
      EnvelopeSchema.parse({ messageId: '', messageType: 'ping', data: {}, done: true }),
    ).toThrow();
  });

  it('rejects a missing done flag', () => {
    expect(() => EnvelopeSchema.parse({ messageId: 'a', messageType: 'ping', data: {} })).toThrow();
  });
});

describe('method schemas', () => {
  it('ping responds with the pong literal', () => {
    expect(PingResponseSchema.parse({ result: 'pong' }).result).toBe('pong');
    expect(() => PingResponseSchema.parse({ result: 'nope' })).toThrow();
  });

  it('echo round-trips its text', () => {
    const req = EchoRequestSchema.parse({ text: 'hello' });
    expect(EchoResponseSchema.parse({ text: req.text }).text).toBe('hello');
  });
});

describe('method registry', () => {
  it('exposes ping and echo', () => {
    expect(Object.keys(Methods).sort()).toEqual(['echo', 'ping']);
  });

  it('MethodNameSchema only accepts registered names', () => {
    expect(MethodNameSchema.parse('ping')).toBe('ping');
    expect(() => MethodNameSchema.parse('frobnicate')).toThrow();
  });
});

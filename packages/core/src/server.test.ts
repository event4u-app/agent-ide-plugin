import { describe, expect, it } from 'vitest';
import type { Envelope } from '@event4u-agent/protocol';
import { NdjsonParser, encodeEnvelope } from '@event4u-agent/shared';
import { Dispatcher } from './server.js';

const request = (messageType: string, data: unknown, messageId = 'r1'): Envelope => ({
  messageId,
  messageType,
  data,
  done: true,
});

describe('Dispatcher', () => {
  const dispatcher = new Dispatcher();

  it('answers ping with pong, preserving messageId', async () => {
    const res = await dispatcher.dispatch(request('ping', {}, 'p42'));
    expect(res.messageId).toBe('p42');
    expect(res.messageType).toBe('ping');
    expect(res.data).toEqual({ result: 'pong' });
    expect(res.done).toBe(true);
  });

  it('echoes the request text', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 'hi there' }));
    expect(res.data).toEqual({ text: 'hi there' });
  });

  it('returns an error envelope for an unknown method', async () => {
    const res = await dispatcher.dispatch(request('frobnicate', {}));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'unknown_method' });
  });

  it('returns an error envelope when echo payload is invalid', async () => {
    const res = await dispatcher.dispatch(request('echo', { text: 123 }));
    expect(res.messageType).toBe('error');
    expect(res.data).toMatchObject({ code: 'handler_error' });
  });
});

describe('full wire round-trip (encode -> parse -> dispatch)', () => {
  it('processes a serialized request through the parser', async () => {
    const dispatcher = new Dispatcher();
    const parsed: Envelope[] = [];
    const parser = new NdjsonParser((e) => parsed.push(e));

    parser.push(encodeEnvelope(request('echo', { text: 'wire' }, 'w1')));
    expect(parsed).toHaveLength(1);

    const res = await dispatcher.dispatch(parsed[0]!);
    expect(res.messageId).toBe('w1');
    expect(res.data).toEqual({ text: 'wire' });
  });
});

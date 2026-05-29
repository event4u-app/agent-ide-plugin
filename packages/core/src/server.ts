import {
  type Envelope,
  type EchoRequest,
  type EchoResponse,
  EchoRequestSchema,
  type PingResponse,
  PingRequestSchema,
  MethodNameSchema,
} from '@event4u-agent/protocol';

/** A handler maps a validated request payload to a response payload. */
type Handler = (data: unknown) => Promise<unknown> | unknown;

/**
 * The Agent Core request/response dispatcher.
 *
 * Transport-agnostic on purpose: {@link dispatch} takes one inbound
 * {@link Envelope} and returns the response envelope. The stdio wiring lives
 * in `main.ts`; tests drive {@link dispatch} directly with no streams.
 */
export class Dispatcher {
  private readonly handlers: Record<string, Handler> = {
    ping: (): PingResponse => ({ result: 'pong' }),
    echo: (data: unknown): EchoResponse => {
      const req: EchoRequest = EchoRequestSchema.parse(data);
      return { text: req.text };
    },
  };

  async dispatch(envelope: Envelope): Promise<Envelope> {
    const methodResult = MethodNameSchema.safeParse(envelope.messageType);
    if (!methodResult.success) {
      return this.errorEnvelope(
        envelope.messageId,
        'unknown_method',
        `Unknown messageType: ${envelope.messageType}`,
      );
    }

    const method = methodResult.data;
    // `ping` takes no payload; validate it has the empty shape.
    if (method === 'ping') {
      PingRequestSchema.parse(envelope.data ?? {});
    }

    try {
      const result = await this.handlers[method]!(envelope.data);
      return {
        messageId: envelope.messageId,
        messageType: method,
        data: result,
        done: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorEnvelope(envelope.messageId, 'handler_error', message);
    }
  }

  private errorEnvelope(messageId: string, code: string, message: string): Envelope {
    return {
      messageId,
      messageType: 'error',
      data: { code, message },
      done: true,
    };
  }
}

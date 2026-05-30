import {
  type ConnectResponse,
  ConnectRequestSchema,
  type Envelope,
  type EchoRequest,
  type EchoResponse,
  EchoRequestSchema,
  type PingResponse,
  PingRequestSchema,
  MethodNameSchema,
  type RootStatusResponse,
  type WorkspaceFoldersChangedResponse,
  WorkspaceFoldersChangedRequestSchema,
} from '@event4u-agent/protocol';
import { WorkspaceCoordinator } from './context/workspace-coordinator.js';

/** A handler maps a validated request payload to a response payload. */
type Handler = (data: unknown) => Promise<unknown> | unknown;

/**
 * The Agent Core request/response dispatcher.
 *
 * Transport-agnostic on purpose: {@link dispatch} takes one inbound
 * {@link Envelope} and returns the response envelope. The stdio wiring lives
 * in `main.ts`; tests drive {@link dispatch} directly with no streams.
 *
 * Stateful workspace concerns (root registry, walk + index lifecycle, per-root
 * status) live behind an injected {@link WorkspaceCoordinator} (T-MR11) so the
 * dispatcher stays a thin routing layer.
 */
export class Dispatcher {
  private readonly handlers: Record<string, Handler>;

  constructor(private readonly coordinator: WorkspaceCoordinator = new WorkspaceCoordinator()) {
    this.handlers = {
      ping: (): PingResponse => ({ result: 'pong' }),
      echo: (data: unknown): EchoResponse => {
        const req: EchoRequest = EchoRequestSchema.parse(data);
        return { text: req.text };
      },
      connect: async (data: unknown): Promise<ConnectResponse> => {
        const req = ConnectRequestSchema.parse(data ?? {});
        const status = await this.coordinator.connect(req.workspaceFolders);
        return { ack: true, roots: this.coordinator.roots(), status };
      },
      workspaceFoldersChanged: async (data: unknown): Promise<WorkspaceFoldersChangedResponse> => {
        const req = WorkspaceFoldersChangedRequestSchema.parse(data ?? {});
        const status = await this.coordinator.applyChange(req.added, req.removed);
        return { ack: true, status };
      },
      rootStatus: (): RootStatusResponse => ({ status: this.coordinator.status() }),
    };
  }

  /** Release the workspace coordinator's timers (shutdown). */
  dispose(): void {
    this.coordinator.dispose();
  }

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

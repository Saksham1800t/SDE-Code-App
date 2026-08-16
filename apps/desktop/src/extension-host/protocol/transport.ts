import { Disposable, Emitter, Event, IDisposable } from '../../kernel';
import { ExtensionHostMessage } from './messages';

/** One end of a two-way message channel between host and extension; the seam a future separate-process host swaps without touching anything above it. */
export interface IExtensionTransport extends IDisposable {
  send(message: ExtensionHostMessage): void;
  readonly onMessage: Event<ExtensionHostMessage>;
}

/** v1's transport: two linked in-process instances that deliver directly to each other's `onMessage`, indistinguishable from real IPC to anything above this layer. */
class InProcessTransport extends Disposable implements IExtensionTransport {
  private readonly emitter = this._register(new Emitter<ExtensionHostMessage>());
  readonly onMessage = this.emitter.event;

  private peer: InProcessTransport | null = null;

  /** @internal wiring — only createInProcessTransportPair should call this. */
  _linkTo(peer: InProcessTransport): void {
    this.peer = peer;
  }

  send(message: ExtensionHostMessage): void {
    this.peer?._deliver(message);
  }

  /** @internal — invoked by the linked peer's send(), not by this instance itself. */
  private _deliver(message: ExtensionHostMessage): void {
    this.emitter.fire(message);
  }

  dispose(): void {
    this.peer = null;
    super.dispose();
  }
}

/** Creates a linked pair of in-process transports (`[hostSide, extensionSide]`); sending on one fires `onMessage` on the other. */
export function createInProcessTransportPair(): [IExtensionTransport, IExtensionTransport] {
  const a = new InProcessTransport();
  const b = new InProcessTransport();
  a._linkTo(b);
  b._linkTo(a);
  return [a, b];
}

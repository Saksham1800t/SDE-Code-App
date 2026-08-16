import { ServiceIdentifier } from './serviceIdentifier';
import { SyncDescriptor } from './syncDescriptor';

/** A registry mapping service identifiers to a resolved instance or a {@link SyncDescriptor} recipe; the "composition root" data structure, built explicitly at bootstrap rather than via scattered decorator side effects. */
export class ServiceCollection {
  private readonly entries = new Map<string, unknown>();

  constructor(...entries: ReadonlyArray<readonly [ServiceIdentifier<unknown>, unknown]>) {
    for (const [id, instanceOrDescriptor] of entries) {
      this.set(id, instanceOrDescriptor);
    }
  }

  set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | SyncDescriptor<T>): void {
    this.entries.set(id.serviceId, instanceOrDescriptor);
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this.entries.has(id.serviceId);
  }

  get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined {
    return this.entries.get(id.serviceId) as T | SyncDescriptor<T> | undefined;
  }
}

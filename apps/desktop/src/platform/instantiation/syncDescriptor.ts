/** A recipe for constructing a service rather than the service itself; registering a descriptor instead of a built instance is what makes services lazy — one nobody asks for is never constructed. */
export class SyncDescriptor<T> {
  constructor(
    readonly ctor: new (...args: any[]) => T,
    readonly staticArguments: readonly unknown[] = [],
  ) {}
}

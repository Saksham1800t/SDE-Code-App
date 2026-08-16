import { Disposable, DisposableStore, IDisposable } from '../../kernel';
import { ServiceCollection } from './serviceCollection';
import { createServiceIdentifier, ServiceIdentifier } from './serviceIdentifier';
import { SyncDescriptor } from './syncDescriptor';

/** A constructor that optionally declares its own service dependencies via a static `inject` array, in the exact order expected as constructor parameters; omit `inject` if there are none. */
export interface ServiceCtor<T> {
  new (...args: any[]): T;
  readonly inject?: readonly ServiceIdentifier<any>[];
}

export interface IInstantiationService {
  /** Constructs `ctor`, resolving its static `inject` list through this container and appending `staticArguments`; a plain factory call — the container does NOT take ownership of the result. */
  createInstance<T>(ctor: ServiceCtor<T>, ...staticArguments: unknown[]): T;

  /** Resolves a registered service by identifier; descriptor-backed services are constructed on first use, memoized as singletons, and owned by this container for disposal. */
  getService<T>(id: ServiceIdentifier<T>): T;

  /** Creates a scoped child container that resolves from `services` first, falling back to this container; intended for later per-window or per-extension-host scopes. */
  createChild(services: ServiceCollection): IInstantiationService;
}

export const IInstantiationService = createServiceIdentifier<IInstantiationService>('instantiationService');

function isDisposable(value: unknown): value is IDisposable {
  return typeof value === 'object' && value !== null && typeof (value as IDisposable).dispose === 'function';
}

export class InstantiationService extends Disposable implements IInstantiationService {
  /** Singletons this exact container constructed — disposed when this container is. */
  private readonly ownedSingletons = this._register(new DisposableStore());

  constructor(
    private readonly services: ServiceCollection,
    private readonly parent?: InstantiationService,
  ) {
    super();
    // Make the container itself resolvable as a service, for the rare case something needs to construct instances dynamically rather than have a fixed dependency injected.
    if (!this.services.has(IInstantiationService)) {
      this.services.set(IInstantiationService, this);
    }
  }

  createInstance<T>(ctor: ServiceCtor<T>, ...staticArguments: unknown[]): T {
    const dependencies = (ctor.inject ?? []).map((id) => this.getService(id));
    return new ctor(...dependencies, ...staticArguments);
  }

  getService<T>(id: ServiceIdentifier<T>): T {
    const existing = this.services.get(id);

    if (existing instanceof SyncDescriptor) {
      const instance = this.createInstance(existing.ctor as ServiceCtor<T>, ...existing.staticArguments);
      // Memoize: from now on this identifier resolves straight to the
      // instance, so the descriptor's constructor never runs twice.
      this.services.set(id, instance);
      if (isDisposable(instance)) {
        this.ownedSingletons.add(instance);
      }
      return instance;
    }

    if (existing !== undefined) {
      return existing as T;
    }

    if (this.parent) {
      return this.parent.getService(id);
    }

    throw new Error(`No provider registered for service "${id.serviceId}".`);
  }

  createChild(services: ServiceCollection): InstantiationService {
    return new InstantiationService(services, this);
  }
}

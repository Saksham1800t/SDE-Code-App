/** A token standing in for a service interface at runtime (interfaces don't exist post-compile); deliberately not using decorators+reflect-metadata like VS Code's DI, instead a static `inject` array (see {@link ServiceCtor}). */
export interface ServiceIdentifier<T> {
  readonly serviceId: string;
  /** Never assigned at runtime — exists purely so `typeof ISomeService` carries `T` through generic inference; accessing it at runtime would be a bug. */
  readonly _serviceBrand: T;
}

/** Declares a new service identifier, called once per service interface at module scope; the binding is deliberately both a type and a value sharing one name, the same trick VS Code's `createDecorator` uses. */
export function createServiceIdentifier<T>(serviceId: string): ServiceIdentifier<T> {
  // The cast is the one deliberate escape hatch here: `serviceId` is the only field that needs to exist at runtime; `_serviceBrand` is type-system-only.
  return { serviceId } as ServiceIdentifier<T>;
}

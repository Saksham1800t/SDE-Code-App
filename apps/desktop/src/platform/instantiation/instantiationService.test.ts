import { describe, expect, it, vi } from 'vitest';
import { createServiceIdentifier } from './serviceIdentifier';
import { ServiceCollection } from './serviceCollection';
import { SyncDescriptor } from './syncDescriptor';
import { InstantiationService } from './instantiationService';

interface IGreeterService {
  greet(): string;
}
const IGreeterService = createServiceIdentifier<IGreeterService>('greeterService');

class GreeterService implements IGreeterService {
  greet(): string {
    return 'hello';
  }
}

interface IWelcomeService {
  welcome(): string;
}
const IWelcomeService = createServiceIdentifier<IWelcomeService>('welcomeService');

class WelcomeService implements IWelcomeService {
  static readonly inject = [IGreeterService] as const;
  constructor(private readonly greeter: IGreeterService) {}

  welcome(): string {
    return `${this.greeter.greet()}, welcome!`;
  }
}

describe('InstantiationService', () => {
  it('resolves a service with no dependencies', () => {
    const services = new ServiceCollection([IGreeterService, new SyncDescriptor(GreeterService)]);
    const instantiationService = new InstantiationService(services);

    expect(instantiationService.getService(IGreeterService).greet()).toBe('hello');
  });

  it('resolves a service whose dependency is itself resolved through the container', () => {
    const services = new ServiceCollection(
      [IGreeterService, new SyncDescriptor(GreeterService)],
      [IWelcomeService, new SyncDescriptor(WelcomeService)],
    );
    const instantiationService = new InstantiationService(services);

    expect(instantiationService.getService(IWelcomeService).welcome()).toBe('hello, welcome!');
  });

  it('memoizes a descriptor-backed service — the same instance is returned every time', () => {
    const services = new ServiceCollection([IGreeterService, new SyncDescriptor(GreeterService)]);
    const instantiationService = new InstantiationService(services);

    const first = instantiationService.getService(IGreeterService);
    const second = instantiationService.getService(IGreeterService);

    expect(first).toBe(second);
  });

  it('createInstance resolves declared dependencies and appends static arguments after them', () => {
    class Thing {
      static readonly inject = [IGreeterService] as const;
      constructor(
        public readonly greeter: IGreeterService,
        public readonly label: string,
      ) {}
    }
    const services = new ServiceCollection([IGreeterService, new SyncDescriptor(GreeterService)]);
    const instantiationService = new InstantiationService(services);

    const thing = instantiationService.createInstance(Thing, 'my-label');

    expect(thing.greeter.greet()).toBe('hello');
    expect(thing.label).toBe('my-label');
  });

  it('throws a clear error for an unregistered service', () => {
    const instantiationService = new InstantiationService(new ServiceCollection());
    expect(() => instantiationService.getService(IGreeterService)).toThrow(/greeterService/);
  });

  describe('child containers', () => {
    it('falls back to the parent for services not overridden in the child', () => {
      const parentServices = new ServiceCollection([IGreeterService, new SyncDescriptor(GreeterService)]);
      const parent = new InstantiationService(parentServices);
      const child = parent.createChild(new ServiceCollection());

      expect(child.getService(IGreeterService).greet()).toBe('hello');
    });

    it("the child's own registration takes precedence over the parent's", () => {
      const parent = new InstantiationService(
        new ServiceCollection([IGreeterService, new SyncDescriptor(GreeterService)]),
      );
      class OverriddenGreeter implements IGreeterService {
        greet(): string {
          return 'overridden';
        }
      }
      const child = parent.createChild(new ServiceCollection([IGreeterService, new SyncDescriptor(OverriddenGreeter)]));

      expect(child.getService(IGreeterService).greet()).toBe('overridden');
      expect(parent.getService(IGreeterService).greet()).toBe('hello');
    });
  });

  describe('disposal', () => {
    class DisposableGreeter implements IGreeterService {
      readonly dispose = vi.fn();
      greet(): string {
        return 'hello';
      }
    }

    it('disposes a descriptor-resolved singleton when the container is disposed', () => {
      const greeter = new DisposableGreeter();
      const services = new ServiceCollection([IGreeterService, new SyncDescriptor(class {
        constructor() {
          return greeter;
        }
      } as unknown as new () => IGreeterService)]);
      const instantiationService = new InstantiationService(services);

      instantiationService.getService(IGreeterService); // resolve it so the container takes ownership
      instantiationService.dispose();

      expect(greeter.dispose).toHaveBeenCalledTimes(1);
    });

    it('does NOT dispose an already-built instance registered directly (the container never constructed it)', () => {
      const greeter = new DisposableGreeter();
      const services = new ServiceCollection([IGreeterService, greeter]);
      const instantiationService = new InstantiationService(services);

      instantiationService.getService(IGreeterService);
      instantiationService.dispose();

      expect(greeter.dispose).not.toHaveBeenCalled();
    });

    it('does NOT auto-dispose a transient object built via createInstance directly', () => {
      class TransientThing implements IGreeterService {
        readonly dispose = vi.fn();
        greet(): string {
          return 'transient';
        }
      }
      const instantiationService = new InstantiationService(new ServiceCollection());
      const transient = instantiationService.createInstance(TransientThing);

      instantiationService.dispose();

      expect(transient.dispose).not.toHaveBeenCalled();
    });
  });
});

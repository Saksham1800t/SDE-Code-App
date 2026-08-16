import { describe, expect, it } from 'vitest';
import { matchesActivationEvent } from './activationEvents';

describe('matchesActivationEvent', () => {
  it('matches an exact event name', () => {
    expect(matchesActivationEvent(['onStartupFinished'], 'onStartupFinished')).toBe(true);
  });

  it('does not match an unrelated event', () => {
    expect(matchesActivationEvent(['onStartupFinished'], 'onCommand:foo.bar')).toBe(false);
  });

  it('"*" matches any fired event', () => {
    expect(matchesActivationEvent(['*'], 'onCommand:anything')).toBe(true);
    expect(matchesActivationEvent(['*'], 'onStartupFinished')).toBe(true);
  });

  it('matches one of several declared events', () => {
    expect(matchesActivationEvent(['onCommand:a', 'onCommand:b'], 'onCommand:b')).toBe(true);
  });

  it('an empty declared-events list never matches', () => {
    expect(matchesActivationEvent([], 'onStartupFinished')).toBe(false);
  });
});

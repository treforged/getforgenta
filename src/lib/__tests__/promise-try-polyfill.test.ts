import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePromiseTry } from '../promise-try-polyfill';

/**
 * ⚠️ THIS SUITE HAS TO DELETE `Promise.try` TO TEST ANYTHING.
 *
 * The polyfill's whole job is to appear on an engine that lacks the method, and every engine this
 * repo runs on locally (Node 24) HAS it. So a test that simply calls `ensurePromiseTry()` and then
 * uses `Promise.try` is testing V8, not the polyfill - it would pass identically with the file
 * deleted. Each case below removes the native method first, and the first case proves the removal
 * itself worked, so "the polyfill behaved" cannot be a native result wearing its name.
 *
 * CI's Node 22 does NOT have it, so on the runner the removal is a no-op and the same assertions
 * exercise the same polyfill. That is the point: both engines end up testing the shim.
 */

type PromiseWithTry = PromiseConstructor & { try?: unknown };

const native = Object.getOwnPropertyDescriptor(Promise, 'try');

function withoutNativeTry(): void {
  delete (Promise as PromiseWithTry).try;
  ensurePromiseTry();
}

afterEach(() => {
  delete (Promise as PromiseWithTry).try;
  if (native) Object.defineProperty(Promise, 'try', native);
});

describe('the harness can actually remove the method (so the cases below mean something)', () => {
  it('deleting Promise.try leaves it absent before the polyfill installs', () => {
    delete (Promise as PromiseWithTry).try;
    expect(typeof (Promise as PromiseWithTry).try).not.toBe('function');
    ensurePromiseTry();
    expect(typeof (Promise as PromiseWithTry).try).toBe('function');
  });
});

describe('the polyfill matches the spec', () => {
  it('resolves with what the function returns', async () => {
    withoutNativeTry();
    await expect((Promise as PromiseWithTry & { try: <T>(f: () => T) => Promise<T> }).try(() => 41 + 1)).resolves.toBe(42);
  });

  it('adopts a returned thenable rather than resolving with the promise itself', async () => {
    withoutNativeTry();
    const run = (Promise as PromiseWithTry & { try: <T>(f: () => PromiseLike<T>) => Promise<T> }).try;
    await expect(run(() => Promise.resolve('adopted'))).resolves.toBe('adopted');
  });

  it('REJECTS on a synchronous throw instead of throwing out of the call', async () => {
    withoutNativeTry();
    const run = (Promise as PromiseWithTry & { try: (f: () => never) => Promise<never> }).try;
    // The assertion is that this line does not throw - the failure arrives as a rejection.
    const result = run(() => {
      throw new Error('sync boom');
    });
    await expect(result).rejects.toThrow('sync boom');
  });

  it('passes its extra arguments through to the function', async () => {
    withoutNativeTry();
    const run = (Promise as PromiseWithTry & { try: (f: (...a: unknown[]) => unknown, ...a: unknown[]) => Promise<unknown> }).try;
    await expect(run((a, b) => `${String(a)}-${String(b)}`, 'x', 'y')).resolves.toBe('x-y');
  });

  it('installs as a non-enumerable property, like a native method', () => {
    withoutNativeTry();
    const descriptor = Object.getOwnPropertyDescriptor(Promise, 'try');
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.configurable).toBe(true);
    expect(Object.keys(Promise)).not.toContain('try');
  });

  it('never overwrites an implementation that is already there', () => {
    delete (Promise as PromiseWithTry).try;
    const sentinel = (): Promise<string> => Promise.resolve('mine');
    Object.defineProperty(Promise, 'try', { value: sentinel, writable: true, configurable: true, enumerable: false });
    ensurePromiseTry();
    expect((Promise as PromiseWithTry).try).toBe(sentinel);
  });
});

/**
 * THE WIRING. This repo has shipped an exported, tested function with no production caller before
 * (`shouldLeaveOnboarding`, 2026-09-15) - six green assertions over code the app never ran. A
 * polyfill is the same shape and worse: unwired, every test above still passes and PDF import is
 * still broken on the devices this exists for.
 */
describe('the PDF path actually calls it', () => {
  const source = readFileSync(join(__dirname, '..', 'pdf-text.ts'), 'utf8');

  it('imports it', () => {
    expect(source).toContain("from './promise-try-polyfill'");
  });

  it('calls it, and before the pdf.js import rather than after', () => {
    const callAt = source.indexOf('ensurePromiseTry();');
    const importAt = source.indexOf("await import('pdfjs-dist')");
    expect(callAt).toBeGreaterThan(-1);
    expect(importAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(importAt);
  });
});

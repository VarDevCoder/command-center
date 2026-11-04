import { describe, it, expect } from 'vitest';
import { isLoopback } from './isLoopback.js';

describe('isLoopback', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('acepta %s', (address) => {
    expect(isLoopback(address)).toBe(true);
  });

  it.each(['192.168.100.10', '::ffff:192.168.100.10', '127.0.0.2', '0.0.0.0', '', undefined])('rechaza %s', (address) => {
    expect(isLoopback(address)).toBe(false);
  });
});

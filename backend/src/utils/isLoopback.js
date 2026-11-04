const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(remoteAddress) {
  return LOOPBACK_ADDRESSES.has(remoteAddress);
}

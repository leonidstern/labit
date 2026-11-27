// Who counts as "on the same network" for a lab opened to wifi (lib/dev.ts onLan): the subnets of this computer's own
// interfaces and 100.64.0.0/10, so an address `labit invite` prints is one the lab lets in. A public address is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onLan } from '../lib/dev.ts';

const nic = (address, netmask, extra = {}) => ({ address, netmask, family: 'IPv4', internal: false, ...extra });
const nets = { wlan0: [nic('203.0.113.7', '255.255.255.0')], tailscale0: [nic('100.101.102.103', '255.255.255.255')], lo: [nic('127.0.0.1', '255.0.0.0', { internal: true })], big: [nic('198.51.100.9', '255.0.0.0')] };

test('an address on the same subnet as one of the computer\'s own interfaces is nearby', () => {
  assert.ok(onLan('203.0.113.42', nets));
  assert.ok(!onLan('203.0.114.42', nets), 'the next subnet over is not');
});

test('100.64.0.0/10 is nearby, the addresses around it are not', () => {
  assert.ok(onLan('100.64.0.1', nets) && onLan('100.127.255.254', nets));
  assert.ok(!onLan('100.63.255.255', nets) && !onLan('100.128.0.1', nets));
});

test('a public address, a huge subnet, a loopback interface and a non-address do not count', () => {
  assert.ok(!onLan('8.8.8.8', nets));
  assert.ok(!onLan('198.51.100.77', nets), 'an interface on a /8 lets nobody in by its subnet');
  assert.ok(!onLan('127.0.0.5', nets), 'the loopback interface is not a network of guests');
  assert.ok(!onLan('fe80::1', nets) && !onLan('', nets) && !onLan('203.0.113.x', nets));
});

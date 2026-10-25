import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { keyMatches } from "./push.ts";

// The VAPID public key as /api/pushConfig returns it (base64url); `bytes` gives
// the raw applicationServerKey a browser hands back on a subscription.
const KEY =
  "BKd0F0RQ7Zk8pXPTq5wQx3v1aXHOD1yYqjS1Nn0Yr6nKcVmQ0uLfR3kL8Yb2gH7wS9xM4tN6pD1eA5cZ8vQ3jUo";

const bytes = (b64url: string): ArrayBuffer => {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
};

test("a subscription minted under the current key matches", () => {
  assert(keyMatches(bytes(KEY), KEY));
});

test("a subscription minted under a retired key does NOT match", () => {
  // Rotating VAPID keys leaves existing subscriptions undeliverable (403, not
  // pruned server-side); without this check the client re-registers the same
  // dead endpoint forever.
  const rotated =
    "BAaaF0RQ7Zk8pXPTq5wQx3v1aXHOD1yYqjS1Nn0Yr6nKcVmQ0uLfR3kL8Yb" +
    "2gH7wS9xM4tN6pD1eA5cZ8vQ3jUo";
  assertEquals(keyMatches(bytes(KEY), rotated), false);
});

test("a differing length is a mismatch, not a crash", () => {
  assertEquals(keyMatches(new Uint8Array([1, 2, 3]).buffer, KEY), false);
});

test("an unreadable applicationServerKey is treated as matching", () => {
  // Some browsers don't expose PushSubscriptionOptions.applicationServerKey; an
  // unknown key must not trigger a re-subscribe of a possibly good
  // subscription.
  assert(keyMatches(null, KEY));
  assert(keyMatches(undefined, KEY));
});

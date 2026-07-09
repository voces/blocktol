import { assertEquals } from "@std/assert";
import { _sealRecordForTest } from "./webpush.ts";

// The complete worked example from RFC 8291 §5. Feeding the RFC's published ECDH
// shared secret through the post-ECDH pipeline and reproducing its exact output
// body verifies the whole encryption path — the RFC 8291 auth mix, RFC 8188 HKDF
// key/nonce derivation, AES-128-GCM, and header framing — against an
// authoritative fixture, no live push service needed. (The ECDH step itself is
// bypassed because Deno's WebCrypto can't deriveBits from an imported private
// key; the standard generateKey ECDH used in production is exercised at runtime.)
const fromB64URL = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const toB64URL = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

Deno.test("sealRecord reproduces the RFC 8291 §5 test vector", async () => {
  const plaintext = new TextEncoder().encode(
    "When I grow up, I want to be a watermelon",
  );
  const ecdhSecret = fromB64URL("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs");
  const salt = fromB64URL("DGv6ra1nlYgDCS1FRnbzlw");
  const asPublic = fromB64URL(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  );
  const uaPublic = fromB64URL(
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  );
  const authSecret = fromB64URL("BTBZMqHH6r4Tts7J_aSIgg");

  const body = await _sealRecordForTest(
    ecdhSecret,
    uaPublic,
    authSecret,
    asPublic,
    salt,
    plaintext,
  );

  assertEquals(
    toB64URL(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

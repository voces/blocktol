import { assertEquals } from "@std/assert";
import { extractUserId, getUserIdMaybe } from "./userid.ts";

const withAuth = async (authorization: string) => {
  const req = new Request("http://x.test/api/m", {
    headers: { authorization },
  });
  await extractUserId(req, {});
  return getUserIdMaybe(req);
};

Deno.test("extractUserId accepts every id shape ever minted", async () => {
  for (
    const id of [
      "0a1b2c3d4e5f6", // 13-char base36 (current)
      "0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p", // 32-char base36 pairs
      "123e4567-e89b-12d3-a456-426614174000", // crypto.randomUUID
      "t-123e4567-e89b-12", // test fixtures
    ]
  ) assertEquals(await withAuth(id), id);
});

Deno.test("extractUserId treats a malformed header as anonymous", async () => {
  for (
    const bad of [
      "x".repeat(37),
      "abc def",
      "abc`def",
      "Bearer abc",
      "abc'; DROP",
    ]
  ) assertEquals(await withAuth(bad), undefined, bad);
});

const getRandomValues = crypto.getRandomValues.bind(crypto) ??
  ((arr: number[]) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  });

// 64 bits of randomness encoded as a single base36 big integer (13 chars). The
// id isn't a real secret — it just rides the authorization header for
// convenience — so only collision resistance matters, and 64 bits stays
// collision-free well past any realistic user count (birthday bound ~2^32).
// (The old scheme was 32 chars: two base36 chars per byte, where each pair used
// only 256 of its 1296 values — ~23% wasted even before the entropy drop.)
const ID_BYTES = 8;
const ID_LENGTH = 13;

const randomId = () => {
  let n = 0n;
  for (const byte of getRandomValues(new Uint8Array(ID_BYTES))) {
    n = (n << 8n) | BigInt(byte);
  }
  return n.toString(36).padStart(ID_LENGTH, "0");
};

export const getId = () => {
  // Sign-in links: `/login/<id>` (long) and `/l/<id>` (the move-to-device
  // short alias). Both drop the id into storage so the app boots as that user.
  if (location.pathname.startsWith("/login/")) {
    localStorage.setItem("id", location.pathname.slice(7));
  } else if (location.pathname.startsWith("/l/")) {
    localStorage.setItem("id", location.pathname.slice(3));
  }

  const storedId = localStorage.getItem("id");
  if (storedId) return storedId;

  const id = randomId();

  localStorage.setItem("id", id);

  return id;
};

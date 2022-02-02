export const getId = () => {
  const storedId = localStorage.getItem("id");
  if (storedId) return storedId;

  // Generate random 1024-character id
  const id = Array.from(crypto.getRandomValues(new Uint8Array(4096)))
    .map((c) => String.fromCharCode(c))
    .join("")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 1024);

  localStorage.setItem("id", id);

  return id;
};

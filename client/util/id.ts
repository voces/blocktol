const getRandomValues = crypto.getRandomValues.bind(crypto) ??
  ((arr: number[]) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  });

const randomId = () =>
  Array.from(
    getRandomValues(new Uint8Array(16)),
    (v) => v.toString(36).padStart(2, "0"),
  )
    .join("");

export const getId = () => {
  if (location.pathname.startsWith("/login/")) {
    localStorage.setItem("id", location.pathname.slice(7));
  }

  const storedId = localStorage.getItem("id");
  if (storedId) return storedId;

  const id = randomId();

  localStorage.setItem("id", id);

  return id;
};

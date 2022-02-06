const randomUUID =
  // deno-lint-ignore no-explicit-any
  () => ((crypto as any) as { randomUUID: () => string }).randomUUID();

export const getId = () => {
  const storedId = localStorage.getItem("id");
  if (storedId?.match(/^[0-9a-f\-]+$/)) return storedId;

  const id = randomUUID();

  localStorage.setItem("id", id);

  return id;
};

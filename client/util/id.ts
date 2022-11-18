const hexDigits = "0123456789abcdef";
const createUUID = () => {
  // http://www.ietf.org/rfc/rfc4122.txt
  const s: string[] = [];
  for (let i = 0; i < 36; i++) {
    s[i] = hexDigits[Math.floor(Math.random() * 0x10)];
  }
  s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
  s[19] = hexDigits[(parseInt(s[19], 16) & 0x3) | 0x8]; // bits 6-7 of the clock_seq_hi_and_reserved to 01
  s[8] =
    s[13] =
    s[18] =
    s[23] =
      "-";

  return s.join("");
};

const randomUUID = () => crypto?.randomUUID?.() ?? createUUID();

export const getId = () => {
  const storedId = localStorage.getItem("id");
  if (storedId?.match(/^[0-9a-f\-]+$/)) return storedId;

  const id = randomUUID();

  localStorage.setItem("id", id);

  return id;
};

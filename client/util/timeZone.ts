export const getTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

// The viewer's resolved BCP-47 locale (e.g. "en-US", "de-DE"), from the same
// Intl resolution getTimeZone uses. Sent with a push subscription so the server
// can store it (on the user) and render their push copy in it (see user.locale).
export const getLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

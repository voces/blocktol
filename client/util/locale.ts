// The viewer's resolved BCP-47 locale (e.g. "en-US"). Sent with a push
// subscription so the server can store it (`user.locale`) and render push copy
// in it.
export const getLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

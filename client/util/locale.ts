// The viewer's resolved BCP-47 locale (e.g. "en-US", "de-DE"), from the same
// Intl resolution getTimeZone uses. Sent with a push subscription so the server
// can render that device's push copy in its locale (see push_subscription.locale).
export const getLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;

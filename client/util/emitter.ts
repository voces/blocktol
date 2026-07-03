export type EventMap = {
  [name: string]: unknown;
};

type EventMapArray<Events> = {
  [Event in keyof Events]?: ((event: Events[Event]) => void)[];
};

export interface Emitter<Events extends EventMap> {
  addEventListener: <Event extends keyof Events>(
    name: Event,
    callback: (event: Events[Event]) => void,
  ) => (event: Events[Event]) => void;
  removeEventListener: <Event extends keyof Events>(
    name: Event,
    callback: (event: Events[Event]) => void,
  ) => void;
  removeEventListeners: <Event extends keyof Events>(name?: Event) => void;
  dispatchEvent: <Event extends keyof Events>(
    name: Event,
    event: Events[Event],
  ) => void;
}

export const emitter = <T, Events extends EventMap>(
  host: T,
): T & Emitter<Events> => {
  let events: EventMapArray<Events> = {};

  const modifiedHost = host as T & Emitter<Events>;

  if (!modifiedHost.addEventListener) {
    modifiedHost.addEventListener = <Event extends keyof Events>(
      name: Event,
      callback: (event: Events[Event]) => void,
    ) => {
      const callbacks: ((event: Events[Event]) => void)[] = events[name] ?? [];

      if (!events[name]) events[name] = callbacks;

      callbacks.push(callback);

      return callback;
    };
  }

  if (!modifiedHost.removeEventListener) {
    modifiedHost.removeEventListener = <Event extends keyof Events>(
      name: Event,
      callback: (event: Events[Event]) => void,
    ) => {
      const callbacks: ((event: Events[Event]) => void)[] | undefined =
        events[name] ?? undefined;
      if (!callbacks) return;

      const index = callbacks.indexOf(callback);
      if (index >= 0) callbacks.splice(index, 1);
    };
  }

  if (!modifiedHost.removeEventListeners) {
    modifiedHost.removeEventListeners = (name) => {
      if (!name) {
        events = {};
        return;
      }

      events[name] = [];
    };
  }

  if (!modifiedHost.dispatchEvent) {
    modifiedHost.dispatchEvent = <Event extends keyof Events>(
      name: Event,
      event: Events[Event],
    ) => {
      const callbacks: ((event: Events[Event]) => void)[] | undefined =
        events[name] ?? undefined;
      if (!callbacks) return;

      callbacks.forEach((callback) => callback.call(host, event));
    };
  }

  return modifiedHost;
};

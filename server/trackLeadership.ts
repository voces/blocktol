const _trackLeadership = (
  channel: BroadcastChannel,
  callback: () => void,
) => {
  let value = -Infinity;
  let status = "node";
  let cancelElection: (() => void) | undefined;

  const startElection = () => {
    value = Math.random();
    channel.postMessage({ kind: "election", value });

    const winElectionTimeout = setTimeout(() => {
      value = -Infinity;
      status = "leader";
      clearTimeout(autoStart);
      setInterval(() => channel.postMessage({ kind: "heartbeat" }), 1_000);
      callback();
      channel.postMessage({ kind: "veto" }); // Stop the count!
    }, 1_000);

    cancelElection = () => {
      value = -Infinity;
      clearTimeout(winElectionTimeout);
      cancelElection = undefined;
    };
  };

  let autoStart = setTimeout(startElection, 2000);
  const stallElection = () => {
    clearTimeout(autoStart);
    autoStart = setTimeout(startElection, 2000);
  };

  channel.addEventListener("message", (e) => {
    if (typeof e.data === "object") {
      if (e.data.kind === "election") {
        if (status === "leader") channel.postMessage({ kind: "veto" });
        else {
          if (e.data.value > value) cancelElection?.();
          stallElection();
        }
      } else if (e.data.kind === "veto") cancelElection?.();
      else if (e.data.kind === "heartbeat") stallElection();
    }
  });
};

let leader = false;

export const isLeader = () => leader;
export const trackLeadership = (
  channel: BroadcastChannel,
  callback: () => void,
) =>
  _trackLeadership(channel, () => {
    leader = true;
    callback();
  });

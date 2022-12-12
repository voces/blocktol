import { Fragment, h } from "preact";
import { useEffect, useRef, useState } from "preact/compat";

export const Timer = ({ to }: { to: number }) => {
  const now = useRef(Date.now()).current;
  const [time, setTime] = useState(0);

  useEffect(() => {
    let animationFrame = -1;
    const animate = () => {
      const time = Math.min((Date.now() - now) / 1000, to);
      setTime(time);
      if (time < to) animationFrame = requestAnimationFrame(animate);
    };
    animate();

    return () => cancelAnimationFrame(animationFrame);
  }, []);

  return <>{time.toFixed(2)}</>;
};

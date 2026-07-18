import { h } from "preact";
import { useMemo } from "preact/compat";
import qrcode from "qrcode-generator";
import { t } from "../util/t.ts";

/**
 * `value` as a crisp SVG QR — dark modules on a white field, drawn as unit-tall
 * rects with consecutive dark cells in a row coalesced into one rect (far fewer
 * nodes). Error-correction "H" (~30%) so a logo can safely overlay the centre.
 * `quiet` is the surrounding margin, in modules.
 */
export const QrCode = (
  { value, quiet = 2 }: { value: string; quiet?: number },
) => {
  const { size, rows } = useMemo(() => {
    const qr = qrcode(0, "H");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const rows: { x: number; y: number; w: number }[] = [];
    for (let r = 0; r < n; r++) {
      let run = 0;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && qr.isDark(r, c);
        if (dark) {
          run++;
        } else if (run) {
          rows.push({ x: quiet + c - run, y: quiet + r, w: run });
          run = 0;
        }
      }
    }
    return { size: n + quiet * 2, rows };
  }, [value, quiet]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: "100%", display: "block", shapeRendering: "crispEdges" }}
      role="img"
      aria-label={t("a11y.qr")}
    >
      <rect width={size} height={size} fill="#fff" />
      {rows.map((m, i) => (
        <rect key={i} x={m.x} y={m.y} width={m.w} height={1} fill="#111" />
      ))}
    </svg>
  );
};

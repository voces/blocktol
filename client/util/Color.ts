export class Color {
  private r: number;
  private g: number;
  private b: number;
  private alpha: number;

  constructor(color: string) {
    if (color[0] === "#" && (color.length === 7 || color.length === 9)) {
      this.r = parseInt(color.slice(1, 3), 16);
      this.g = parseInt(color.slice(3, 5), 16);
      this.b = parseInt(color.slice(5, 7), 16);
      this.alpha = color.length === 9
        ? parseInt(color.slice(7, 9), 16) / 255
        : 1;
    } else {
      throw new Error("Unable to handle color");
    }
  }

  toHSLObject() {
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    const cMax = Math.max(r, g, b);
    const cMin = Math.min(r, g, b);
    const delta = cMax - cMin;
    const l = (cMax + cMin) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    const h = delta === 0
      ? 0
      : (60 * (cMax === r
        ? (((g - b) / delta) % 6)
        : cMax === g
        ? ((b - r) / delta + 2)
        : ((r - g) / delta + 4)));
    return { h, s, l };
  }

  toString() {
    const rgb = `${this.r}, ${this.g}, ${this.b}`;
    if (this.alpha !== 1) {
      return `rgba(${rgb}, ${this.alpha})`;
    }
    return `rgb(${rgb})`;
  }
}

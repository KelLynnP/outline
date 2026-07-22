// Deterministic tag → color, so #work is always the same hue everywhere
// (task list chips, calendar blocks) without any configuration.

function tagHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) % 360;
  return h;
}

export function hueColors(h: number) {
  return {
    bg: `hsl(${h} 70% 90%)`,
    border: `hsl(${h} 45% 58%)`,
    ink: `hsl(${h} 55% 28%)`,
  };
}

export function tagColors(tag: string) {
  return hueColors(tagHue(tag));
}

// Swatch choices for manual events.
export const EVENT_HUES = [10, 35, 60, 140, 180, 210, 270, 320];

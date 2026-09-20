const GAP = 4;
const PIN_SIZE = 24;

function badgeWidth(number, minWidth = PIN_SIZE) {
  return Math.max(minWidth, 12 + String(number).length * 7);
}

export const MARKER_PLACEMENTS = [
  "top-start", "top-center", "top-end",
  "right-start", "right-center", "right-end",
  "bottom-start", "bottom-center", "bottom-end",
  "left-start", "left-center", "left-end",
];

const DEFAULT_ORDER = [
  "top-center", "bottom-center", "right-center", "left-center",
  "top-start", "top-end", "bottom-start", "bottom-end",
  "right-start", "right-end", "left-start", "left-end",
];

function intersects(a, b, padding = 0) {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}

function inside(rect, viewport) {
  return rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= viewport.width
    && rect.y + rect.height <= viewport.height;
}

function calloutRect(target, size, placement, offset = {}) {
  const [side, align] = placement.split("-");
  let x;
  let y;
  if (side === "top" || side === "bottom") {
    x = align === "start" ? target.x
      : align === "end" ? target.x + target.width - size.width
        : target.x + (target.width - size.width) / 2;
    y = side === "top" ? target.y - size.height - GAP : target.y + target.height + GAP;
  } else {
    x = side === "left" ? target.x - size.width - GAP : target.x + target.width + GAP;
    y = align === "start" ? target.y
      : align === "end" ? target.y + target.height - size.height
        : target.y + (target.height - size.height) / 2;
  }
  return {
    x: Math.round(x + (offset.x || 0)),
    y: Math.round(y + (offset.y || 0)),
    width: Math.ceil(size.width),
    height: Math.ceil(size.height),
  };
}

function pinRect(target, viewport, occupied, otherTargets, number) {
  const width = badgeWidth(number);
  const height = PIN_SIZE;
  const candidates = [
    { x: target.x - width / 2, y: target.y - height / 2 },
    { x: target.x + target.width - width / 2, y: target.y - height / 2 },
    { x: target.x - width / 2, y: target.y + target.height - height / 2 },
    { x: target.x + target.width - width / 2, y: target.y + target.height - height / 2 },
    { x: target.x + (target.width - width) / 2, y: target.y - height - GAP },
    { x: target.x + (target.width - width) / 2, y: target.y + target.height + GAP },
    { x: target.x - width - GAP, y: target.y + (target.height - height) / 2 },
    { x: target.x + target.width + GAP, y: target.y + (target.height - height) / 2 },
  ].map((p) => ({
    x: Math.max(0, Math.min(Math.round(p.x), viewport.width - width)),
    y: Math.max(0, Math.min(Math.round(p.y), viewport.height - height)),
    width,
    height,
  }));
  return candidates.find((candidate) =>
    !occupied.some((rect) => intersects(candidate, rect, 2))
    && !otherTargets.some((rect) => intersects(candidate, rect, 1))) || null;
}

export function layoutMarkers({ viewport, items }) {
  const placements = [];
  const occupied = [];
  const targetRects = items.map((item) => item.target);
  const legendItems = [];
  const diagnostics = [];

  for (const item of items) {
    const marker = item.marker;
    const display = marker.display || "auto";
    const candidates = marker.placement && marker.placement !== "auto"
      ? [marker.placement]
      : DEFAULT_ORDER;
    let labelRect = null;
    let selectedPlacement = null;

    if (display !== "pin") {
      for (const candidate of candidates) {
        const rect = calloutRect(item.target, item.labelSize, candidate, marker.offset);
        if (!inside(rect, viewport)) continue;
        if (targetRects.some((target) => intersects(rect, target, 2))) continue;
        if (occupied.some((used) => intersects(rect, used, 2))) continue;
        labelRect = rect;
        selectedPlacement = candidate;
        break;
      }
    }

    if (labelRect) {
      occupied.push(labelRect);
      placements.push({ marker, target: item.target, display: "callout", placement: selectedPlacement, labelRect });
      continue;
    }

    if (display === "callout") {
      throw new Error(`标记 ${marker.number}「${marker.label}」在 ${marker.placement || "auto"} 没有无碰撞位置`);
    }

    const compactRect = pinRect(item.target, viewport, occupied, targetRects.filter((target) => target !== item.target), marker.number);
    if (!compactRect) throw new Error(`标记 ${marker.number}「${marker.label}」没有无碰撞的编号位置`);
    occupied.push(compactRect);
    legendItems.push({ number: marker.number, label: marker.label, labelWidth: item.labelSize.width });
    diagnostics.push({ number: marker.number, kind: "legend-fallback" });
    placements.push({ marker, target: item.target, display: "pin", pinRect: compactRect });
  }

  let legend = null;
  let screenshotHeight = viewport.height;
  if (legendItems.length) {
    const widest = Math.max(...legendItems.map((entry) => entry.labelWidth));
    const widestBadge = Math.max(...legendItems.map((entry) => badgeWidth(entry.number, 20)));
    const width = Math.min(Math.max(80, viewport.width - 24), Math.max(180, Math.ceil(widest + widestBadge + 24)));
    const textWidth = Math.max(20, width - widestBadge - 24);
    const rows = legendItems.map((entry) => ({
      number: entry.number,
      label: entry.label,
      badgeWidth: badgeWidth(entry.number, 20),
      height: Math.max(28, Math.ceil(entry.labelWidth / textWidth) * 20 + 4),
    }));
    const height = rows.reduce((sum, row) => sum + row.height, 16) + Math.max(0, rows.length - 1) * 4;
    legend = { rect: { x: 12, y: viewport.height + 12, width, height }, items: rows };
    screenshotHeight = viewport.height + height + 24;
  }

  return { viewport, screenshotHeight, placements, legend, diagnostics };
}

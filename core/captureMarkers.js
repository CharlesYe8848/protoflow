import { MARKER_PLACEMENTS, layoutMarkers } from "./markerLayout.js";

const PLACEMENTS = new Set(["auto", ...MARKER_PLACEMENTS]);
const DISPLAYS = new Set(["auto", "callout", "pin"]);

export function validateMarkers(markers) {
  if (markers === undefined) return null;
  if (!Array.isArray(markers)) return "markers 必须是数组";
  const numbers = new Set(), ids = new Set();
  for (const m of markers) {
    if (!m || typeof m.elementId !== "string" || !m.elementId.trim()) return "marker 需要 elementId";
    if (!Number.isSafeInteger(m.number) || m.number < 1 || m.number > 999) return "marker number 必须是 1–999 的整数";
    if (typeof m.label !== "string" || !m.label.trim() || m.label.length > 30) return "marker label 需要 1–30 字的短名称";
    if (m.placement !== undefined && !PLACEMENTS.has(m.placement)) return `marker placement 不支持: ${m.placement}`;
    if (m.display !== undefined && !DISPLAYS.has(m.display)) return `marker display 不支持: ${m.display}`;
    if (m.offset !== undefined) {
      if (!m.offset || typeof m.offset !== "object" || Array.isArray(m.offset)) return "marker offset 必须是 {x,y}";
      for (const key of ["x", "y"]) {
        if (m.offset[key] !== undefined && (!Number.isFinite(m.offset[key]) || Math.abs(m.offset[key]) > 2000))
          return `marker offset.${key} 必须是 -2000 到 2000 的数字`;
      }
    }
    if (numbers.has(m.number) || ids.has(m.elementId)) return "同一截图的 marker 编号和 elementId 不得重复";
    numbers.add(m.number); ids.add(m.elementId);
  }
  return null;
}

// Runs inside the captured page. Keep self-contained so Puppeteer can serialize it.
export function measureCaptureMarkers(markers) {
  document.querySelector('[data-protoflow-capture-markers]')?.remove();
  const items = markers.map((marker) => {
    const matches = [...document.querySelectorAll('[id]')].filter(el => el.id === marker.elementId);
    if (matches.length !== 1) throw new Error(`标记目标 #${marker.elementId} 应唯一存在，实际 ${matches.length} 个`);
    const el = matches[0], rect = el.getBoundingClientRect();
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || rect.width <= 0 || rect.height <= 0)
      throw new Error(`标记目标 #${marker.elementId} 不可见`);
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p), r = p.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
    }
    if (rect.left < left - 1 || rect.top < top - 1 || rect.right > right + 1 || rect.bottom > bottom + 1)
      throw new Error(`标记目标 #${marker.elementId} 被裁切，请调整 actions 或选择完整可见的元素`);
    const pointerValue = el.style.getPropertyValue('pointer-events');
    const pointerPriority = el.style.getPropertyPriority('pointer-events');
    el.style.setProperty('pointer-events', 'auto', 'important');
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (pointerValue) el.style.setProperty('pointer-events', pointerValue, pointerPriority);
    else el.style.removeProperty('pointer-events');
    if (!hit || (hit !== el && !el.contains(hit))) throw new Error(`标记目标 #${marker.elementId} 被遮挡`);

    const measure = document.createElement('div');
    measure.textContent = `${marker.number} · ${marker.label}`;
    measure.style.cssText = 'position:fixed;left:-10000px;top:-10000px;box-sizing:border-box;padding:3px 7px;font:600 14px/20px system-ui,sans-serif;white-space:nowrap;';
    document.body.appendChild(measure);
    const labelRect = measure.getBoundingClientRect();
    measure.remove();
    return {
      marker,
      target: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      labelSize: { width: labelRect.width, height: labelRect.height },
    };
  });
  return { viewport: { width: innerWidth, height: innerHeight }, items };
}

// Runs inside the captured page. Geometry is decided by the pure layout engine beforehand.
export function renderCaptureMarkers(layout) {
  document.querySelector('[data-protoflow-capture-markers]')?.remove();
  const host = document.createElement('div');
  host.setAttribute('data-protoflow-capture-markers', '');
  host.setAttribute('popover', 'manual');
  host.style.cssText = `all:initial;position:absolute;left:0;top:0;margin:0;padding:0;border:0;width:${layout.viewport.width}px;height:${layout.screenshotHeight}px;background:transparent;z-index:2147483647;pointer-events:none;`;
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  host.showPopover();

  for (const placement of layout.placements) {
    const r = placement.target;
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;border:2px solid #b42318;border-radius:4px;`;
    shadow.appendChild(box);
    const label = document.createElement('div');
    if (placement.display === 'callout') {
      label.textContent = `${placement.marker.number} · ${placement.marker.label}`;
      const l = placement.labelRect;
      label.style.cssText = `position:absolute;box-sizing:border-box;left:${l.x}px;top:${l.y}px;padding:3px 7px;background:#b42318;color:white;font:600 14px/20px system-ui,sans-serif;border-radius:4px;white-space:nowrap;`;
    } else {
      label.textContent = String(placement.marker.number);
      const p = placement.pinRect;
      label.style.cssText = `position:absolute;box-sizing:border-box;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;display:grid;place-items:center;background:#b42318;color:white;font:700 13px/1 system-ui,sans-serif;border:2px solid white;border-radius:999px;`;
    }
    shadow.appendChild(label);
  }

  if (layout.legend) {
    const legend = document.createElement('div');
    const r = layout.legend.rect;
    legend.style.cssText = `position:absolute;box-sizing:border-box;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;padding:8px 10px;display:grid;gap:4px;background:white;color:#1f2937;border:1px solid #d1d5db;border-radius:8px;font:500 14px/20px system-ui,sans-serif;`;
    for (const entry of layout.legend.items) {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:8px;min-height:${entry.height}px;`;
      const number = document.createElement('span');
      number.textContent = String(entry.number);
      number.style.cssText = `width:${entry.badgeWidth}px;height:20px;display:grid;place-items:center;flex:none;background:#b42318;color:white;border-radius:999px;font-weight:700;`;
      const text = document.createElement('span');
      text.textContent = entry.label;
      text.style.cssText = 'min-width:0;overflow-wrap:anywhere;line-height:20px;';
      row.append(number, text);
      legend.appendChild(row);
    }
    shadow.appendChild(legend);
    document.documentElement.style.minHeight = `${layout.screenshotHeight}px`;
    document.body.style.minHeight = `${layout.screenshotHeight}px`;
  }
  return { screenshotHeight: layout.screenshotHeight, diagnostics: layout.diagnostics };
}

export async function applyCaptureMarkers(page, markers) {
  const geometry = await page.evaluate(measureCaptureMarkers, markers);
  const layout = layoutMarkers(geometry);
  await page.evaluate(renderCaptureMarkers, layout);
  return layout;
}

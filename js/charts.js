/* ==========================================================================
   Charts — hand-rolled SVG, no library.
   Lines draw in (stroke-dashoffset on pathLength=1), bars grow from the
   baseline, dots pop in sequence. Detail charts support press-and-drag
   scrubbing with a callback so the page header can show the value.
   Animation classes are defined in app.css and disabled under
   prefers-reduced-motion or when the body has .no-anim.
   ========================================================================== */
(function (root) {
  "use strict";
  let gid = 0;
  const f1 = v => v.toFixed(1);

  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
    return { ticks, lo: start, hi: end, step };
  }

  function wrap(svg) {
    const d = document.createElement("div");
    d.innerHTML = svg;              // HTML parser puts <svg> in the right namespace
    return d.firstChild;
  }

  /* ------------------------------------------------------------- plot */
  function plot(o) {
    const W = Math.round(o.w), H = o.h || 200;
    const axes = o.axes !== false;
    const ml = axes ? (o.ml || 38) : 2, mr = axes ? 6 : 2, mt = axes ? 12 : 4, mb = axes ? 22 : 4;
    const iw = W - ml - mr, ih = H - mt - mb, n = o.xs.length;
    const series = o.series.filter(s => s.data.some(v => v != null));

    let lo = Infinity, hi = -Infinity;
    const take = v => { if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
    series.forEach(s => s.data.forEach(take));
    (o.band || []).forEach(b => { if (b) { take(b[0]); take(b[1]); } });
    (o.targets || []).forEach(take);
    if (o.zero !== undefined) take(o.zero);
    if (o.hline !== undefined) take(o.hline);
    if (!isFinite(lo)) {
      const e = document.createElement("div");
      e.className = "chart-empty"; e.textContent = o.empty || "No data in this range yet.";
      e.style.height = H + "px";
      return e;
    }
    if (o.ymin !== undefined) lo = Math.min(lo, o.ymin);
    const pad = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.04);
    let nt = niceTicks(o.zero !== undefined && lo >= o.zero ? o.zero : lo - pad, hi + pad, o.yticks || 4);
    lo = nt.lo; hi = nt.hi;

    const X = i => ml + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const Y = v => mt + ih - ((v - lo) / (hi - lo)) * ih;
    const P = [];
    const id = "g" + (++gid);

    // grid + y labels
    if (axes) {
      for (const t of nt.ticks) {
        const y = Y(t).toFixed(1);
        P.push(`<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" class="grid"/>`);
        P.push(`<text x="${ml - 7}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" class="ylab">${o.yfmt ? o.yfmt(t) : Math.round(t)}</text>`);
      }
      // x labels, spaced so they never collide
      const minGap = 58, lastX = X(n - 1);
      const step = Math.max(1, Math.ceil((n - 1) / Math.max(1, Math.floor(iw / minGap))));
      for (let i = 0; i < n; i++) {
        const isLast = i === n - 1;
        if (!isLast && i % step) continue;
        if (!isLast && lastX - X(i) < minGap) continue;
        const a = i === 0 ? "start" : isLast ? "end" : "middle";
        P.push(`<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="${a}" class="xlab">${o.xs[i]}</text>`);
      }
    }
    if (o.zero !== undefined && axes) {
      const y = Y(o.zero).toFixed(1);
      P.push(`<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" class="zero"/>`);
    }
    if (o.hline !== undefined) {
      const y = Y(o.hline).toFixed(1);
      P.push(`<line x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}" class="hline" style="stroke:${o.hlineColor || "var(--muted)"}"/>`);
    }

    // confidence band
    if (o.band) {
      const up = [], dn = [];
      o.band.forEach((b, i) => { if (b) { up.push(`${X(i).toFixed(1)},${Y(b[1]).toFixed(1)}`); dn.unshift(`${X(i).toFixed(1)},${Y(b[0]).toFixed(1)}`); } });
      if (up.length > 1) P.push(`<polygon points="${up.concat(dn).join(" ")}" fill="${o.bandColor || "var(--exp)"}" fill-opacity=".16" class="fade"/>`);
    }

    // per-point target ticks (stepped)
    if (o.targets) {
      const bw = Math.max(3, Math.min(18, iw / n * 0.62));
      o.targets.forEach((t, i) => {
        if (t == null) return;
        P.push(`<line x1="${(X(i) - bw / 2 - 1).toFixed(1)}" x2="${(X(i) + bw / 2 + 1).toFixed(1)}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="tgt"/>`);
      });
    }

    series.forEach((s, si) => {
      if (s.type === "bars") {
        const bw = Math.max(2.5, Math.min(18, iw / n * 0.62));
        const z = Y(o.zero !== undefined ? o.zero : lo);
        s.data.forEach((v, i) => {
          if (v == null) return;
          const y = Y(v), top = Math.min(y, z), h = Math.max(1.5, Math.abs(y - z));
          const col = s.colorFn ? s.colorFn(v, i) : s.color;
          P.push(`<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bw / 3).toFixed(1)}" fill="${col}" class="${y > z ? "grow-down" : "grow"}" style="--i:${Math.min(i, 60)}"/>`);
        });
      } else if (s.type === "dots") {
        s.data.forEach((v, i) => {
          if (v == null) return;
          P.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${s.r || 2.6}" fill="${s.color}" fill-opacity="${s.opacity ?? .45}" class="pop" style="--i:${Math.min(i, 80)}"/>`);
        });
      } else {
        // line (optionally with area fill beneath)
        const segs = []; let cur = [];
        s.data.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
        if (cur.length) segs.push(cur);
        if (s.area) {
          P.push(`<defs><linearGradient id="${id}a${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`);
          segs.forEach(sg => {
            if (sg.length < 2) return;
            const d = "M" + sg.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L") +
              ` L${sg[sg.length - 1][0].toFixed(1)} ${(mt + ih).toFixed(1)} L${sg[0][0].toFixed(1)} ${(mt + ih).toFixed(1)} Z`;
            P.push(`<path d="${d}" fill="url(#${id}a${si})" class="fade"/>`);
          });
        }
        segs.forEach(sg => {
          if (sg.length === 1) { P.push(`<circle cx="${sg[0][0].toFixed(1)}" cy="${sg[0][1].toFixed(1)}" r="2.5" fill="${s.color}"/>`); return; }
          const d = "M" + sg.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
          P.push(`<path d="${d}" pathLength="1" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.2}" stroke-linecap="round" stroke-linejoin="round" class="draw"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`);
        });
        if (s.endDot) {
          for (let i = s.data.length - 1; i >= 0; i--) if (s.data[i] != null) {
            P.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(s.data[i]).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--card)" stroke-width="2" class="pop late"/>`);
            break;
          }
        }
        if (s.nodes) s.data.forEach((v, i) => {
          if (v == null) return;
          P.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.6" fill="var(--card)" stroke="${s.color}" stroke-width="2" class="pop late" style="--i:${i}"/>`);
        });
      }
    });

    // scrub layer
    if (o.onScrub) {
      P.push(`<line class="scrub-line" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" visibility="hidden"/>`);
      P.push(`<circle class="scrub-dot" r="5" visibility="hidden"/>`);
      P.push(`<rect class="scrub-hit" x="${ml}" y="0" width="${iw}" height="${H}" fill="transparent"/>`);
    }

    const svg = wrap(`<svg class="chart${o.cls ? " " + o.cls : ""}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label || "chart"}">${P.join("")}</svg>`);

    if (o.onScrub) {
      const line = svg.querySelector(".scrub-line"), dot = svg.querySelector(".scrub-dot");
      const main = o.scrubSeries != null ? series[o.scrubSeries] : series[series.length - 1];
      const at = e => {
        const r = svg.getBoundingClientRect();
        const x = (e.clientX - r.left) * (W / r.width);
        let i = Math.round((x - ml) / iw * (n - 1));
        i = Math.max(0, Math.min(n - 1, i));
        // snap to the nearest index that has a value
        if (main && main.data[i] == null) {
          let best = null;
          for (let k = 0; k < n; k++) if (main.data[k] != null && (best === null || Math.abs(k - i) < Math.abs(best - i))) best = k;
          if (best !== null) i = best;
        }
        const xi = X(i).toFixed(1);
        line.setAttribute("x1", xi); line.setAttribute("x2", xi); line.setAttribute("visibility", "visible");
        if (main && main.data[i] != null) {
          dot.setAttribute("cx", xi); dot.setAttribute("cy", Y(main.data[i]).toFixed(1));
          dot.setAttribute("fill", main.color); dot.setAttribute("visibility", "visible");
        }
        o.onScrub(i);
      };
      const end = () => { line.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); o.onScrub(null); };
      svg.addEventListener("pointerdown", e => { svg.setPointerCapture(e.pointerId); at(e); });
      svg.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "mouse") at(e); });
      svg.addEventListener("pointerup", end);
      svg.addEventListener("pointercancel", end);
      svg.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") end(); });
    }
    return svg;
  }

  /* Tiny chart for dashboard cards. */
  function spark(o) {
    return plot(Object.assign({ axes: false, h: 56 }, o));
  }

  root.Charts = { plot, spark, niceTicks, f1 };
})(typeof self !== "undefined" ? self : globalThis);

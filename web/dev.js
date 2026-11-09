import {
  APPS, NODES, WIRES, alertOf, back, currentHop, describe, fullTrip, hopsFor, initialState,
  next, restart, screen, skippedNodes, stepNumber, toggleFault, toggleMystery, toggleScenario,
  totalSteps, withApp,
} from "./dev-core.mjs";

const NS = "http://www.w3.org/2000/svg";
const NODE_W = 250;
const NODE_H = 150;
const POSITIONS = {
  browser: { x: 160, y: 330 },
  dns: { x: 540, y: 150 },
  server: { x: 540, y: 400 },
  gateway: { x: 840, y: 400 },
  service: { x: 1140, y: 400 },
  database: { x: 1440, y: 400 },
};
const PHONE = { w: 190, h: 340 };
const HOP_MS = 1100;
const FULL_SPEED_MS = 70;
const CROWD = 18;

function el(parent, tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

// One stroke family for every node, drawn around (x, y) at about 44px.
const ICONS = {
  dns(group, x, y) {
    el(group, "path", { d: `M${x - 22} ${y - 14} q11 -6 22 0 q11 -6 22 0 v28 q-11 -6 -22 0 q-11 -6 -22 0 Z M${x} ${y - 14} v28` });
  },
  server(group, x, y) {
    for (const top of [-20, -5.5, 9]) {
      el(group, "rect", { x: x - 20, y: y + top, width: 40, height: 11, rx: 3 });
      el(group, "circle", { class: "dot", cx: x + 12, cy: y + top + 5.5, r: 2 });
    }
  },
  gateway(group, x, y) {
    el(group, "path", { d: `M${x} ${y - 21} L${x + 18} ${y - 14} V${y + 1} C${x + 18} ${y + 12} ${x + 9} ${y + 18} ${x} ${y + 22} C${x - 9} ${y + 18} ${x - 18} ${y + 12} ${x - 18} ${y + 1} V${y - 14} Z` });
    el(group, "path", { d: `M${x - 7} ${y + 1} l5 5 l10 -11` });
  },
  service(group, x, y) {
    const teeth = 2 * Math.PI * 18;
    el(group, "circle", { class: "teeth", cx: x, cy: y, r: 18, "stroke-dasharray": `${teeth / 16} ${teeth / 16}` });
    el(group, "circle", { cx: x, cy: y, r: 13 });
    el(group, "circle", { cx: x, cy: y, r: 4.5 });
  },
  database(group, x, y) {
    el(group, "ellipse", { cx: x, cy: y - 14, rx: 18, ry: 6 });
    el(group, "path", { d: `M${x - 18} ${y - 14} V${y + 14} A18 6 0 0 0 ${x + 18} ${y + 14} V${y - 14} M${x - 18} ${y} A18 6 0 0 0 ${x + 18} ${y}` });
  },
};

export function createDevTrack() {
  const section = document.getElementById("dev");
  const map = document.getElementById("dev-map");
  const caption = section.querySelector(".dev-caption");
  const progress = document.getElementById("dev-progress");
  const count = document.getElementById("dev-count");
  const title = document.getElementById("dev-title");
  const text = document.getElementById("dev-text");
  const armed = document.getElementById("dev-armed");
  const fullButton = document.getElementById("dev-full");
  const appButtons = [...section.querySelectorAll("[data-app]")];
  const scenarioButtons = [...section.querySelectorAll("[data-scenario]")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let state = initialState();
  let animationFrame = null;
  let replayTimer = null;
  let crowdFrame = null;
  const rush = { load: 0.15, waiting: 0, last: 0, started: 0 };

  const wireElements = new Map();
  for (const [a, b] of WIRES) {
    const from = POSITIONS[a], to = POSITIONS[b];
    wireElements.set(`${a}-${b}`, el(map, "line", { class: "dev-wire", x1: from.x, y1: from.y, x2: to.x, y2: to.y }));
  }

  // Extra servers appear behind the first one when engineers scale up for rush hour.
  const server = POSITIONS.server;
  const stack = el(map, "g", { class: "dev-stack" });
  for (const offset of [36, 18]) {
    el(stack, "rect", { x: server.x - NODE_W / 2 + offset, y: server.y - NODE_H / 2 - offset, width: NODE_W, height: NODE_H, rx: 14 });
  }

  // The rush-hour crowd travels behind the boxes, so requests disappear into the server.
  const crowd = el(map, "g", { class: "dev-crowd" });
  const dots = Array.from({ length: CROWD }, () => el(crowd, "circle", { r: 7 }));

  const nodeParts = new Map();
  for (const [name, node] of Object.entries(NODES)) {
    if (name === "browser") continue;
    const { x, y } = POSITIONS[name];
    const group = el(map, "g", { class: "dev-node" });
    el(group, "rect", { x: x - NODE_W / 2, y: y - NODE_H / 2, width: NODE_W, height: NODE_H, rx: 14 });
    ICONS[name](el(group, "g", { class: "dev-icon" }), x, y - 36);
    el(group, "text", { x, y: y + 22 }, node.title);
    el(group, "text", { x, y: y + 54, class: "dev-node-sub" }, node.sub);
    const badge = el(group, "g", { class: "dev-badge" });
    el(badge, "rect", { x: x + NODE_W / 2 - 92, y: y - NODE_H / 2 + 12, width: 82, height: 34, rx: 17 });
    const badgeText = el(badge, "text", { x: x + NODE_W / 2 - 51, y: y - NODE_H / 2 + 29 });
    nodeParts.set(name, { group, badgeText });
  }

  // The DNS answer is this number, so students can see where the phone goes next.
  const address = el(map, "text", { class: "dev-address", x: server.x, y: server.y + NODE_H / 2 + 36 });

  const meter = el(map, "g", { class: "dev-meter" });
  const meterY = server.y + NODE_H / 2 + 24;
  el(meter, "rect", { class: "dev-meter-track", x: server.x - NODE_W / 2, y: meterY, width: NODE_W, height: 16, rx: 8 });
  const meterFill = el(meter, "rect", { class: "dev-meter-fill", x: server.x - NODE_W / 2, y: meterY, width: NODE_W, height: 16, rx: 8 });
  const meterText = el(meter, "text", { class: "dev-meter-text", x: server.x, y: meterY + 46 });

  // The phone is drawn as a real screen, so the result of the trip has somewhere to appear.
  const phoneX = POSITIONS.browser.x, phoneY = POSITIONS.browser.y;
  const screenBox = { left: phoneX - 78, top: phoneY - 146, width: 156, height: 292 };
  const phone = el(map, "g", { class: "dev-node" });
  el(phone, "rect", { class: "page-frame", x: phoneX - PHONE.w / 2, y: phoneY - PHONE.h / 2, width: PHONE.w, height: PHONE.h, rx: 22 });
  el(phone, "rect", { class: "page-address-bar", x: screenBox.left, y: screenBox.top, width: screenBox.width, height: 30, rx: 15 });
  const barText = el(phone, "text", { class: "page-address", x: phoneX, y: screenBox.top + 15 });
  const screenRoot = el(phone, "g");
  el(phone, "text", { x: phoneX, y: phoneY + PHONE.h / 2 + 42 }, NODES.browser.title);
  nodeParts.set("browser", { group: phone });

  const packet = el(map, "g", { class: "dev-packet" });
  const packetBox = el(packet, "rect", { rx: 26, height: 52 });
  const packetText = el(packet, "text");
  packet.style.display = "none";

  // Where the packet waits at each stop: just above the box, never over its name.
  function dock(name) {
    if (name === "browser") return { x: phoneX, y: phoneY - PHONE.h / 2 - 36 };
    const { x, y } = POSITIONS[name];
    return { x, y: y - NODE_H / 2 - 36 };
  }

  function placePacket(x, y) {
    packet.setAttribute("transform", `translate(${x} ${y})`);
  }

  function setPacket(hop) {
    packetText.textContent = hop.packet;
    const width = packetText.getComputedTextLength() + 46;
    packetBox.setAttribute("width", width);
    packetBox.setAttribute("x", -width / 2);
    packetBox.setAttribute("y", -26);
    packet.setAttribute("class", `dev-packet ${hop.kind}`);
    packet.style.display = "";
  }

  // Keep the label inside the map when the packet sits at the far edge.
  function clampX(x) {
    const half = Number(packetBox.getAttribute("width")) / 2;
    return Math.min(1600 - half - 4, Math.max(half + 4, x));
  }

  function animateHop(hop, duration) {
    cancelAnimationFrame(animationFrame);
    setPacket(hop);
    const from = dock(hop.from), to = dock(hop.to);
    if (duration <= 0 || reduceMotion) {
      placePacket(clampX(to.x), to.y);
      return;
    }
    const started = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - started) / duration);
      const eased = t * t * (3 - 2 * t);
      placePacket(clampX(from.x + (to.x - from.x) * eased), from.y + (to.y - from.y) * eased);
      if (t < 1) animationFrame = requestAnimationFrame(frame);
    }
    animationFrame = requestAnimationFrame(frame);
  }

  // Phone screens. Each part fades in after the one before it.
  const { left, width } = screenBox;
  const contentTop = screenBox.top + 40;
  const contentBottom = screenBox.top + screenBox.height;
  const middle = (contentTop + contentBottom) / 2;

  function part(tag, attributes, label) {
    const element = el(screenRoot, tag, attributes, label);
    element.classList.add("page-in");
    element.style.setProperty("--i", screenRoot.childElementCount - 1);
    return element;
  }

  const SCREENS = {
    feed() {
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 2; column++) {
          part("rect", { class: "page-post", x: left + column * 81, y: contentTop + row * 84, width: 75, height: 76, rx: 6 });
        }
      }
    },
    video() {
      part("rect", { class: "page-video", x: left, y: contentTop, width, height: 96, rx: 6 });
      part("path", { class: "page-play", d: `M${phoneX - 9} ${contentTop + 34} L${phoneX + 15} ${contentTop + 48} L${phoneX - 9} ${contentTop + 62} Z` });
      part("rect", { class: "page-post", x: left, y: contentTop + 102, width, height: 6, rx: 3 });
      part("rect", { class: "page-progress", x: left, y: contentTop + 102, width: 52, height: 6, rx: 3 });
      part("rect", { class: "page-post", x: left, y: contentTop + 120, width: 140, height: 14, rx: 7 });
      part("rect", { class: "page-post", x: left, y: contentTop + 142, width: 96, height: 14, rx: 7 });
      for (const top of [172, 216]) {
        part("rect", { class: "page-post", x: left, y: contentTop + top, width: 64, height: 36, rx: 4 });
        part("rect", { class: "page-post", x: left + 72, y: contentTop + top + 6, width: 84, height: 10, rx: 5 });
      }
    },
    match() {
      part("rect", { class: "page-dark", x: left, y: contentTop, width, height: contentBottom - contentTop, rx: 8 });
      part("text", { class: "page-light-title", x: phoneX, y: contentTop + 36 }, "MATCH FOUND");
      for (let index = 0; index < 5; index++) {
        part("circle", { class: index === 0 ? "page-you" : "page-team-a", cx: left + 14 + index * 32, cy: contentTop + 86, r: 11 });
      }
      part("text", { class: "page-vs", x: phoneX, y: contentTop + 134 }, "VS");
      for (let index = 0; index < 5; index++) {
        part("circle", { class: "page-team-b", cx: left + 14 + index * 32, cy: contentTop + 170, r: 11 });
      }
      part("text", { class: "page-light-small", x: phoneX, y: contentTop + 222 }, "Get ready");
    },
    login() {
      part("text", { class: "page-login-title", x: phoneX, y: contentTop + 40 }, "Log in");
      part("rect", { class: "page-input", x: left + 12, y: contentTop + 64, width: width - 24, height: 32, rx: 6 });
      part("rect", { class: "page-input", x: left + 12, y: contentTop + 106, width: width - 24, height: 32, rx: 6 });
      part("rect", { class: "page-button", x: left + 12, y: contentTop + 156, width: width - 24, height: 36, rx: 18 });
      part("text", { class: "page-button-text", x: phoneX, y: contentTop + 174 }, "Log in");
    },
    error(result) {
      el(screenRoot, "rect", { class: "page-error-bg", x: left, y: contentTop, width, height: contentBottom - contentTop, rx: 8 });
      const words = result.message.split(" ");
      const half = Math.ceil(words.length / 2);
      el(screenRoot, "text", { class: "page-error", x: phoneX, y: middle - 14 }, words.slice(0, half).join(" "));
      el(screenRoot, "text", { class: "page-error", x: phoneX, y: middle + 16 }, words.slice(half).join(" "));
    },
    loading() {
      // Still waiting for an answer: in the fault scenarios this never stops.
      const ring = 2 * Math.PI * 22;
      el(screenRoot, "circle", { class: "page-spinner-track", cx: phoneX, cy: middle - 14, r: 22 });
      el(screenRoot, "circle", { class: "page-spinner", cx: phoneX, cy: middle - 14, r: 22, "stroke-dasharray": `${ring / 4} ${ring}` });
      el(screenRoot, "text", { class: "page-loading", x: phoneX, y: middle + 34 }, "Loading");
    },
    blank() {},
  };

  let shownScreen = null;
  function renderScreen() {
    const result = screen(state);
    const key = `${state.app}:${result.kind}:${result.message ?? ""}`;
    if (key === shownScreen) return; // Redrawing would restart the fade-in and the spinner.
    shownScreen = key;
    screenRoot.replaceChildren();
    SCREENS[result.kind](result);
  }

  // Rush hour: requests stream from the phone to the server, then queue up when it is full.
  const phoneCenter = POSITIONS.browser;
  const lineLength = Math.hypot(server.x - phoneCenter.x, server.y - phoneCenter.y);
  const serverEdge = (server.x - NODE_W / 2 - phoneCenter.x) / (server.x - phoneCenter.x);
  const phoneEdge = (PHONE.w / 2) / (server.x - phoneCenter.x);

  function along(u) {
    return { x: phoneCenter.x + (server.x - phoneCenter.x) * u, y: phoneCenter.y + (server.y - phoneCenter.y) * u };
  }

  function drawCrowd(elapsed) {
    dots.forEach((dot, index) => {
      let u, wobble = 0;
      if (state.phase === "overloaded") {
        u = serverEdge - (12 + index * 17) / lineLength;
        wobble = Math.sin(elapsed * 7 + index) * 1.6;
      } else {
        const speed = state.phase === "scaled" ? 1.1 : 0.5;
        u = (elapsed * speed + index / CROWD) % 1;
      }
      const { x, y } = along(u);
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y + wobble);
      // Only the stretch between the phone and the server is visible; the rest of the queue is "inside" the phones.
      dot.setAttribute("opacity", u < phoneEdge ? 0 : 1);
    });
  }

  function drawMeter() {
    meterFill.style.transform = `scaleX(${rush.load})`;
    meter.classList.toggle("full", rush.load > 0.97);
    meter.classList.toggle("ok", state.phase === "scaled" || state.phase === "done");
    const waiting = Math.round(rush.waiting);
    meterText.textContent = waiting > 0 ? `${waiting.toLocaleString("en")} requests waiting` : "No one waiting";
  }

  const RUSH_TARGETS = {
    ready: { load: 0.15, waiting: 0 },
    surge: { load: 0.9, waiting: 800 },
    overloaded: { load: 1, waiting: 1300 },
    scaled: { load: 0.4, waiting: 0 },
    done: { load: 0.3, waiting: 0 },
  };

  function stepRush(dt) {
    const ease = (target, rate) => { rush.load += (target - rush.load) * Math.min(1, dt * rate); };
    switch (state.phase) {
      case "surge": ease(1, 0.9); rush.waiting += dt * 380; break;
      case "overloaded": rush.load = 1; rush.waiting += dt * 60; break;
      case "scaled": ease(0.4, 2); rush.waiting = Math.max(0, rush.waiting - dt * 650); break;
      case "done": ease(0.3, 2); rush.waiting = 0; break;
      default: rush.load = 0.15; rush.waiting = 0;
    }
  }

  function rushTick(now) {
    const dt = Math.min(0.1, (now - rush.last) / 1000);
    rush.last = now;
    stepRush(dt);
    drawCrowd((now - rush.started) / 1000);
    drawMeter();
    crowdFrame = requestAnimationFrame(rushTick);
  }

  function updateRush() {
    const active = state.scenario === "rush";
    meter.style.display = active ? "" : "none";
    address.style.display = active ? "none" : "";
    stack.classList.toggle("shown", active && (state.phase === "scaled" || state.phase === "done"));
    crowd.style.display = active && ["surge", "overloaded", "scaled"].includes(state.phase) ? "" : "none";
    cancelAnimationFrame(crowdFrame);
    if (!active) return;
    if (reduceMotion) {
      Object.assign(rush, RUSH_TARGETS[state.phase]);
      drawCrowd(0);
      drawMeter();
      return;
    }
    rush.last = performance.now();
    if (!rush.started) rush.started = rush.last;
    crowdFrame = requestAnimationFrame(rushTick);
  }

  function renderProgress(tone) {
    const total = totalSteps(state);
    const done = stepNumber(state);
    if (progress.childElementCount !== total) {
      progress.replaceChildren(...Array.from({ length: total }, () => document.createElement("span")));
    }
    [...progress.children].forEach((segment, index) => segment.classList.toggle("done", index < done));
    caption.className = `dev-caption ${tone}`;
  }

  function renderStatic() {
    const description = describe(state);
    renderProgress(description.tone);
    title.textContent = description.title;
    text.textContent = description.text;
    count.textContent = state.phase === "ready" ? "Start" : `${stepNumber(state)} of ${totalSteps(state)}`;
    armed.hidden = !state.fault || state.mystery;
    fullButton.disabled = state.scenario === "rush";
    for (const button of appButtons) button.setAttribute("aria-pressed", String(button.dataset.app === state.app));
    for (const button of scenarioButtons) {
      const name = button.dataset.scenario;
      button.setAttribute("aria-pressed", String(name === "mystery" ? state.mystery : state.scenario === name));
    }

    const app = APPS[state.app];
    barText.textContent = app.bar;
    address.textContent = app.address;

    const hop = currentHop(state);
    const alert = alertOf(state);
    const skipped = skippedNodes(state);
    for (const [name, { group, badgeText }] of nodeParts) {
      group.classList.toggle("current", Boolean(hop && state.phase === "hop" && hop.to === name));
      group.classList.toggle("alert", alert?.node === name);
      group.classList.toggle("skipped", skipped.includes(name));
      if (badgeText && alert?.node === name) badgeText.textContent = alert.label;
    }
    // Light up the address while the phone learns it and then uses it.
    const usingAddress = hop && state.phase === "hop" && (hop.from === "dns" || (hop.from === "browser" && hop.to === "server"));
    address.classList.toggle("lit", Boolean(usingAddress));

    // Light every wire used so far on this trip.
    for (const wire of wireElements.values()) wire.classList.remove("travelled");
    if (state.scenario === "rush" && state.phase !== "ready") {
      wireElements.get("browser-server").classList.add("travelled");
    } else if (hop) {
      hopsFor(state).slice(0, state.hop + 1).forEach(({ from, to }) => {
        (wireElements.get(`${from}-${to}`) ?? wireElements.get(`${to}-${from}`)).classList.add("travelled");
      });
    }
    renderScreen();
    updateRush();
  }

  function stopMotion() {
    cancelAnimationFrame(animationFrame);
    clearTimeout(replayTimer);
    replayTimer = null;
  }

  function showPacket(duration) {
    const hop = currentHop(state);
    if (!hop || state.phase === "done") {
      packet.style.display = "none";
    } else if (state.phase === "hop") {
      animateHop(hop, duration);
    } else {
      // The request reached the stop and nothing came back: it just sits there.
      animateHop(hop, 0);
      packet.setAttribute("class", "dev-packet stuck");
    }
  }

  function go(newState) {
    if (newState === state) return;
    stopMotion();
    const previous = state;
    state = newState;
    renderStatic();
    const forward = state.phase === "hop" && previous.phase !== "stuck" && state.hop > previous.hop;
    showPacket(forward ? HOP_MS : 0);
  }

  function realSpeed() {
    if (state.scenario === "rush") return;
    stopMotion();
    const trip = fullTrip(state);
    let index = 0;
    function step() {
      state = trip[index];
      renderStatic();
      showPacket(FULL_SPEED_MS);
      count.textContent = "Real speed";
      index++;
      if (index < trip.length) replayTimer = setTimeout(step, FULL_SPEED_MS);
    }
    step();
  }

  const actions = {
    next: () => go(next(state)),
    back: () => go(back(state)),
    restart: () => go(restart(state)),
    full: realSpeed,
    again: () => go(toggleScenario(state, "again")),
    blocked: () => go(toggleScenario(state, "blocked")),
    rush: () => go(toggleScenario(state, "rush")),
    mystery: () => go(toggleMystery(state)),
    dns: () => go(toggleFault(state, "dns")),
    database: () => go(toggleFault(state, "database")),
    instagram: () => go(withApp(state, "instagram")),
    youtube: () => go(withApp(state, "youtube")),
    game: () => go(withApp(state, "game")),
  };

  const KEYS = {
    " ": "next", arrowright: "next", arrowleft: "back", r: "restart", f: "full",
    a: "again", l: "blocked", h: "rush", m: "mystery", d: "dns", b: "database",
    i: "instagram", y: "youtube", g: "game",
  };

  document.getElementById("dev-next").addEventListener("click", actions.next);
  document.getElementById("dev-back").addEventListener("click", actions.back);
  document.getElementById("dev-restart").addEventListener("click", actions.restart);
  fullButton.addEventListener("click", actions.full);
  for (const button of appButtons) button.addEventListener("click", actions[button.dataset.app]);
  for (const button of scenarioButtons) button.addEventListener("click", actions[button.dataset.scenario]);

  renderStatic();

  return {
    onKey(key) {
      const action = KEYS[key.toLowerCase()];
      if (!action) return false;
      actions[action]();
      return true;
    },
  };
}

import { attachPen } from "./draw.js";

const UNSURE_BELOW = 0.5;
const NS = "http://www.w3.org/2000/svg";

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function svg(parent, tag, attributes, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

export function createAiTrack() {
  const canvas = document.getElementById("ai-canvas");
  const verdict = document.getElementById("ai-verdict");
  const barsRoot = document.getElementById("ai-bars");
  const accuracy = document.getElementById("ai-accuracy");
  const progress = document.getElementById("ai-progress");
  const chart = document.getElementById("ai-chart");
  const samplesRoot = document.getElementById("ai-samples");
  const trainButton = document.getElementById("ai-train");
  const connection = document.getElementById("ai-connection");
  const bars = new Map();
  let latest = null;
  let drawingSeq = 0;

  const pen = attachPen(canvas, { onStroke: sendDrawing });

  async function sendDrawing() {
    const seq = ++drawingSeq;
    const png = await pen.toPng();
    if (seq !== drawingSeq) return; // A newer stroke or a clear has replaced this one.
    post("/api/ai/drawing", png);
  }

  function post(path, body) {
    fetch(path, { method: "POST", body }).catch(() => {
      connection.hidden = false;
    });
  }

  function clearDrawing() {
    drawingSeq++;
    pen.clear();
    post("/api/ai/drawing");
  }

  function reset() {
    clearDrawing();
    post("/api/ai/reset");
  }

  function train() {
    post("/api/ai/train");
  }

  function renderBars(state) {
    if (!bars.size) {
      for (const name of state.classes) {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.innerHTML = `<span class="bar-name"></span><span class="bar-value"></span>
          <div class="bar-track"><div class="bar-fill"></div></div>`;
        row.querySelector(".bar-name").textContent = name[0].toUpperCase() + name.slice(1);
        barsRoot.append(row);
        bars.set(name, row);
      }
    }
    const top = state.probs ? Math.max(...state.probs) : -1;
    state.classes.forEach((name, index) => {
      const row = bars.get(name);
      const value = state.probs ? state.probs[index] : 0;
      row.querySelector(".bar-value").textContent = state.probs ? percent(value) : "–";
      row.querySelector(".bar-fill").style.transform = `scaleX(${value})`;
      row.classList.toggle("leader", state.probs !== null && value === top && top >= UNSURE_BELOW);
    });
  }

  function renderVerdict(state) {
    verdict.className = "verdict";
    if (!state.probs) {
      verdict.textContent = "Waiting for a drawing";
      verdict.classList.add("unsure");
      return;
    }
    const top = Math.max(...state.probs);
    if (top < UNSURE_BELOW) {
      verdict.textContent = state.status === "untrained" ? "No idea. It is only guessing." : "Not sure yet…";
      verdict.classList.add("unsure");
      return;
    }
    const name = state.classes[state.probs.indexOf(top)];
    verdict.textContent = `A ${name}, I'm ${percent(top)} sure`;
    verdict.classList.add("sure");
  }

  function renderChart(state) {
    chart.replaceChildren();
    const left = 54, right = 590, top = 12, bottom = 366;
    const x = (pass) => left + ((right - left) * pass) / state.passes;
    const y = (value) => bottom - (bottom - top) * value;
    for (const value of [0, 0.5, 1]) {
      svg(chart, "line", { class: "chart-grid", x1: left, x2: right, y1: y(value), y2: y(value) });
      svg(chart, "text", { class: "chart-label", x: 0, y: y(value) + 5 }, percent(value));
    }
    svg(chart, "line", { class: "chart-chance", x1: left, x2: right, y1: y(1 / 3), y2: y(1 / 3) });
    svg(chart, "text", { class: "chart-label", x: right, y: y(1 / 3) + 22, "text-anchor": "end" }, "only guessing");
    svg(chart, "text", { class: "chart-label", x: (left + right) / 2, y: 394, "text-anchor": "middle" }, "training passes");

    const points = [state.start_accuracy, ...state.history].map((value, pass) => [x(pass), y(value)]);
    if (points.length > 1) {
      svg(chart, "polyline", { class: "chart-line", points: points.map((p) => p.join(",")).join(" ") });
    }
    const [lastX, lastY] = points[points.length - 1];
    svg(chart, "circle", { class: "chart-dot", cx: lastX, cy: lastY, r: 8 });
  }

  function renderSamples(state) {
    samplesRoot.replaceChildren();
    for (const sample of state.samples) {
      const example = document.createElement("figure");
      example.className = "example";
      const thumbnail = document.createElement("canvas");
      thumbnail.className = "sample";
      thumbnail.width = thumbnail.height = 28;
      const label = document.createElement("figcaption");
      label.textContent = sample.label;
      example.append(thumbnail, label);
      const context = thumbnail.getContext("2d");
      const image = context.createImageData(28, 28);
      sample.pixels.forEach((value, index) => {
        const shade = Math.round(245 - (value / 9) * 200);
        image.data.set([shade, shade + 4, shade + 8, 255], index * 4);
      });
      context.putImageData(image, 0, 0);
      samplesRoot.append(example);
    }
  }

  function render(state) {
    latest = state;
    for (const stage of document.querySelectorAll(".ai-stages .stage")) {
      stage.classList.toggle("active", stage.dataset.stage === state.status);
    }
    renderBars(state);
    renderVerdict(state);
    renderChart(state);
    renderSamples(state);
    accuracy.textContent = percent(state.accuracy);
    trainButton.disabled = state.status !== "untrained";
    progress.textContent = state.pass
      ? `Pass ${state.pass} of ${state.passes}, ${state.examples_seen.toLocaleString("en")} shapes seen`
      : "Not trained yet";
  }

  const events = new EventSource("/api/ai/events");
  events.onmessage = (event) => {
    connection.hidden = true;
    render(JSON.parse(event.data));
  };
  events.onerror = () => {
    connection.hidden = false;
  };

  trainButton.addEventListener("click", train);
  document.getElementById("ai-reset").addEventListener("click", reset);
  document.getElementById("ai-clear").addEventListener("click", clearDrawing);
  document.getElementById("ai-clear-key").addEventListener("click", clearDrawing);

  return {
    onKey(key) {
      const lower = key.toLowerCase();
      if (lower === "t") train();
      else if (lower === "r") reset();
      else if (lower === "c") clearDrawing();
      else return false;
      return true;
    },
    get state() {
      return latest;
    },
  };
}

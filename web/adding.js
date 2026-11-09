// Doing math: the same sum twice. First worked on paper one column at a time, then run
// through a chain of adders made of gates, with the carry passing from box to box.

import { ADD_PLACES, addColumns, bitsToNumber, paperStages, paperText } from "./computer-core.mjs";

const NS = "http://www.w3.org/2000/svg";
const RIPPLE_MS = 450;
const COLUMNS = ADD_PLACES.length;

function el(parent, tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function div(parent, className, text) {
  const element = document.createElement("div");
  element.className = className;
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

export function createAdding() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const numbers = { a: ADD_PLACES.map(() => 0), b: ADD_PLACES.map(() => 0) };
  let stage = 0; // Position in paperStages on the paper screen.
  let rippled = COLUMNS; // Adder boxes that have worked out their column, counted from the right.
  let rippleTimer = null;
  let onAdder = false;

  const value = (row) => bitsToNumber(numbers[row], ADD_PLACES);

  function toggle(row, index) {
    numbers[row][index] = numbers[row][index] ? 0 : 1;
    stage = 0; // A new sum starts from the first column again.
    renderPaper();
    if (onAdder) startRipple();
    else renderAdder();
  }

  // ---- On paper ----
  // Grid columns: a label, then the 16s (only ever an answer digit), then 8, 4, 2 and 1.
  const grid = document.getElementById("paper-grid");
  const captionTitle = document.getElementById("paper-caption-title");
  const captionText = document.getElementById("paper-caption-text");

  div(grid, "paper-label");
  const placeCells = [16, ...ADD_PLACES].map((place) => div(grid, "paper-place", place));
  div(grid, "paper-label paper-carry-label", "carry");
  const carryCells = [16, ...ADD_PLACES].map(() => div(grid, "paper-carry"));

  function bitRow(row) {
    const label = div(grid, "paper-label");
    div(grid, "paper-blank");
    const buttons = ADD_PLACES.map((place, index) => {
      const button = document.createElement("button");
      button.className = "paper-bit";
      button.setAttribute("aria-label", `${row.toUpperCase()}, switch worth ${place}`);
      button.addEventListener("click", () => toggle(row, index));
      grid.append(button);
      return button;
    });
    return { label, buttons };
  }
  const rows = { a: bitRow("a"), b: bitRow("b") };
  div(grid, "paper-label");
  div(grid, "paper-rule");
  const resultLabel = div(grid, "paper-label paper-result");
  const sumCells = [16, ...ADD_PLACES].map(() => div(grid, "paper-sum"));

  function renderPaper() {
    const stages = paperStages(numbers.a, numbers.b);
    stage = Math.min(stage, stages.length - 1);
    const current = stages[stage];
    const passed = stages.slice(0, stage + 1);
    const { columns, carry } = addColumns(numbers.a, numbers.b);
    const columnsDone = passed.filter((step) => step.kind === "column").length;
    const isDone = (index) => COLUMNS - 1 - index < columnsDone; // Columns are done from the right.

    for (const row of ["a", "b"]) {
      rows[row].label.textContent = `${row === "b" ? "+ " : ""}${row.toUpperCase()} = ${value(row)}`;
      rows[row].buttons.forEach((button, index) => {
        button.textContent = numbers[row][index];
        button.classList.toggle("on", Boolean(numbers[row][index]));
        button.setAttribute("aria-pressed", String(Boolean(numbers[row][index])));
      });
    }

    // Grid column 0 is the 16s; grid column i + 1 is switch i.
    const byIndex = new Map(columns.map((column) => [column.index, column]));
    const lastCarryShown = passed.some((step) => step.kind === "carry");
    sumCells[0].textContent = lastCarryShown ? carry : "";
    ADD_PLACES.forEach((_, index) => {
      sumCells[index + 1].textContent = isDone(index) ? byIndex.get(index).sum : "";
    });
    // The carry out of switch i's column is written above the column to its left.
    carryCells.forEach((cell, gridColumn) => {
      const from = byIndex.get(gridColumn);
      cell.textContent = from && isDone(gridColumn) && from.carry ? "1" : "";
    });

    const currentColumn = current.kind === "column" ? current.column.index + 1 : current.kind === "carry" ? 0 : -1;
    const highlight = (cells) => cells.forEach((cell, gridColumn) => cell.classList.toggle("current", gridColumn === currentColumn));
    highlight(placeCells);
    highlight(carryCells);
    highlight(sumCells);
    for (const row of ["a", "b"]) {
      rows[row].buttons.forEach((button, index) => button.classList.toggle("current", index + 1 === currentColumn));
    }

    resultLabel.textContent = current.kind === "done" ? `= ${value("a") + value("b")}` : "";
    const { title, text } = paperText(current, value("a"), value("b"));
    captionTitle.textContent = title;
    captionText.textContent = text;
  }

  // ---- In gates ----
  const map = document.getElementById("adder-map");
  const BOX_X = [520, 820, 1120, 1420]; // The 8s, 4s, 2s and 1s columns.
  const BOX = { w: 210, h: 140, y: 290 };
  const INPUT_Y = 110;
  const SUM_Y = 460;
  const LAMP_R = 28;
  const SIXTEENS_X = 220;

  const legendA = el(map, "text", { class: "adder-legend", x: 30, y: 105 });
  const legendB = el(map, "text", { class: "adder-legend", x: 30, y: 160 });
  const result = el(map, "text", { class: "adder-result", x: 1490, y: SUM_Y });

  function lamp(parent, x, y, label) {
    const group = el(parent, "g", { class: "adder-lamp" });
    el(group, "circle", { class: "gate-lamp", cx: x, cy: y, r: LAMP_R });
    const text = el(group, "text", { x, y });
    if (label) el(parent, "text", { class: "adder-label", x, y: y + LAMP_R + 32 }, label);
    return { group, text };
  }

  // Wires go in first so the boxes and lamps sit on top of them.
  const wires = BOX_X.map((x, index) => {
    const left = x - BOX.w / 2;
    const carryOut = index === 0
      ? el(map, "path", { class: "gate-wire", d: `M${left} ${BOX.y} H${SIXTEENS_X} V${SUM_Y - LAMP_R}` })
      : el(map, "path", { class: "gate-wire", d: `M${left} ${BOX.y} H${BOX_X[index - 1] + BOX.w / 2}` });
    return {
      a: el(map, "path", { class: "gate-wire", d: `M${x - 50} ${INPUT_Y + LAMP_R} V${BOX.y - BOX.h / 2}` }),
      b: el(map, "path", { class: "gate-wire", d: `M${x + 50} ${INPUT_Y + LAMP_R} V${BOX.y - BOX.h / 2}` }),
      sum: el(map, "path", { class: "gate-wire", d: `M${x} ${BOX.y + BOX.h / 2} V${SUM_Y - LAMP_R}` }),
      carryOut,
    };
  });

  const parts = BOX_X.map((x, index) => {
    const box = el(map, "g", { class: "adder-box" });
    el(box, "rect", { x: x - BOX.w / 2, y: BOX.y - BOX.h / 2, width: BOX.w, height: BOX.h, rx: 16 });
    el(box, "text", { x, y: BOX.y }, "ADD");
    if (index > 0) el(map, "text", { class: "adder-carry-label", x: x - BOX.w / 2 - 45, y: BOX.y - 18 }, "carry");

    const inputs = {};
    for (const [row, dx] of [["a", -50], ["b", 50]]) {
      const input = lamp(map, x + dx, INPUT_Y);
      input.group.classList.add("adder-input");
      input.group.setAttribute("role", "button");
      input.group.setAttribute("aria-label", `${row.toUpperCase()}, switch worth ${ADD_PLACES[index]}`);
      input.group.addEventListener("click", () => toggle(row, index));
      el(map, "text", { class: "adder-label", x: x + dx, y: INPUT_Y - LAMP_R - 14 }, row.toUpperCase());
      inputs[row] = input;
    }
    return { box, inputs, sum: lamp(map, x, SUM_Y, ADD_PLACES[index]) };
  });
  el(map, "text", { class: "adder-carry-label", x: (SIXTEENS_X + BOX_X[0] - BOX.w / 2) / 2, y: BOX.y - 18 }, "carry");
  const sixteens = lamp(map, SIXTEENS_X, SUM_Y, 16);

  function showLamp({ group, text }, bit) {
    const known = bit !== null;
    group.classList.toggle("on", Boolean(bit));
    group.querySelector("circle").classList.toggle("on", Boolean(bit));
    group.classList.toggle("unknown", !known);
    text.textContent = known ? bit : "?";
  }

  function renderAdder() {
    const { columns, carry } = addColumns(numbers.a, numbers.b);
    const byIndex = new Map(columns.map((column) => [column.index, column]));
    const worked = (index) => COLUMNS - 1 - index < rippled;

    BOX_X.forEach((_, index) => {
      const column = byIndex.get(index);
      const ready = worked(index);
      showLamp(parts[index].inputs.a, numbers.a[index]);
      showLamp(parts[index].inputs.b, numbers.b[index]);
      wires[index].a.classList.toggle("on", Boolean(numbers.a[index]));
      wires[index].b.classList.toggle("on", Boolean(numbers.b[index]));
      showLamp(parts[index].sum, ready ? column.sum : null);
      wires[index].sum.classList.toggle("on", ready && Boolean(column.sum));
      wires[index].carryOut.classList.toggle("on", ready && Boolean(column.carry));
      parts[index].box.classList.toggle("working", COLUMNS - 1 - index === rippled);
    });
    const finished = rippled >= COLUMNS;
    showLamp(sixteens, finished ? carry : null);
    legendA.textContent = `A = ${value("a")}`;
    legendB.textContent = `B = ${value("b")}`;
    result.textContent = finished ? `= ${value("a") + value("b")}` : "";
  }

  // The boxes work one after another from the right, because each needs the carry from the one before.
  function startRipple() {
    clearTimeout(rippleTimer);
    rippled = reduceMotion ? COLUMNS : 0;
    renderAdder();
    const tick = () => {
      rippled++;
      renderAdder();
      if (rippled < COLUMNS) rippleTimer = setTimeout(tick, RIPPLE_MS);
    };
    if (rippled < COLUMNS) rippleTimer = setTimeout(tick, RIPPLE_MS);
  }

  renderPaper();
  renderAdder();

  return {
    values() {
      return { a: value("a"), b: value("b") };
    },
    // Arriving from the gates starts the sum from the first column; coming back keeps the answer.
    enterPaper(fresh) {
      if (fresh) stage = 0;
      renderPaper();
    },
    // Returns false when there is nothing left on this screen, so the track moves on.
    paperNext() {
      if (stage >= paperStages(numbers.a, numbers.b).length - 1) return false;
      stage++;
      renderPaper();
      return true;
    },
    paperBack() {
      if (stage === 0) return false;
      stage--;
      renderPaper();
      return true;
    },
    enterAdder() {
      onAdder = true;
      startRipple();
    },
    leaveAdder() {
      onAdder = false;
      clearTimeout(rippleTimer);
      rippled = COLUMNS;
    },
    reset() {
      numbers.a.fill(0);
      numbers.b.fill(0);
      stage = 0;
      renderPaper();
      if (onAdder) startRipple();
      else renderAdder();
    },
  };
}

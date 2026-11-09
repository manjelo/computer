// The whole machine, running: draws the tiny computer from machine-core.mjs and animates every
// step it takes. Fast by default; slow motion shows one fetch, decode or execute at a time.

import {
  DATA, DISPLAY, MEMORY_SIZE, PROGRAM_NAMES, RAM_SIZE, SCREEN, createCpu, explainDecode,
  explainExecute, explainFetch, makeTasks, resetCpu, shuffledBars, step,
} from "./machine-core.mjs";

const NS = "http://www.w3.org/2000/svg";
const FAST_STEPS_PER_SECOND = 160;
const LOAD_COST = 0.4; // Copying a number from storage is quicker than running an instruction.
const SLOW_PHASE_MS = 1100;
const SLOW_LOAD_BYTES_PER_SECOND = 60;
const PAUSE_MS = { fast: 1200, slow: 2200 };
const REAL_CHIP_STEPS_PER_SECOND = 3e9;
const PHASES = ["fetch", "decode", "execute"];
const ALL_PHASES = { fetch: true, decode: true, execute: true };

const BUS_Y = 345;
const PARTS = {
  cpu: { x: 30, y: 20, w: 570, h: 280, stub: 315 },
  ram: { x: 680, y: 20, w: 570, h: 280, stub: 965 },
  storage: { x: 30, y: 395, w: 270, h: 235, stub: 165 },
  screen: { x: 370, y: 375, w: 280, h: 255, stub: 510 },
  display: { x: 720, y: 395, w: 280, h: 150, stub: 860 },
};

function el(parent, tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

// "about 20 million": one significant figure, in words.
function roughly(value) {
  const [size, word] = value >= 1e9 ? [1e9, "billion"] : value >= 1e6 ? [1e6, "million"] : [1, ""];
  const scaled = value / size;
  const digits = 10 ** Math.floor(Math.log10(scaled));
  return `about ${(Math.round(scaled / digits) * digits).toLocaleString("en")} ${word}`.trim();
}

export function createMachine({ inputs }) {
  const svg = document.getElementById("machine-map");
  const taskList = document.getElementById("machine-task-list");
  const stepCount = document.getElementById("machine-count");
  const phaseText = document.getElementById("machine-phase");

  // ---- Drawing ----
  el(svg, "line", { class: "m-bus", x1: 30, y1: BUS_Y, x2: 1250, y2: BUS_Y });
  el(svg, "text", { class: "m-bus-label", x: 1250, y: BUS_Y + 32 }, "Bus: carries numbers between the parts");
  const stubs = {};
  for (const [name, part] of Object.entries(PARTS)) {
    const edge = part.y > BUS_Y ? part.y : part.y + part.h;
    stubs[name] = el(svg, "line", { class: "m-wire", x1: part.stub, y1: edge, x2: part.stub, y2: BUS_Y });
  }
  const stops = Object.values(PARTS).map((part) => part.stub).sort((a, b) => a - b);
  const segments = stops.slice(1).map((x, index) => ({
    from: stops[index], to: x,
    line: el(svg, "line", { class: "m-wire m-seg", x1: stops[index], y1: BUS_Y, x2: x, y2: BUS_Y }),
  }));

  const boxes = {};
  for (const [name, part] of Object.entries(PARTS)) {
    boxes[name] = el(svg, "rect", { class: `m-box m-box-${name}`, x: part.x, y: part.y, width: part.w, height: part.h, rx: 14 });
  }

  // CPU: control unit, registers, ALU and clock.
  el(svg, "text", { class: "m-title", x: 50, y: 56 }, "CPU");
  el(svg, "text", { class: "m-sub", x: 112, y: 56 }, "follows the program, one step at a time");
  el(svg, "text", { class: "m-small", x: 560, y: 51, "text-anchor": "end" }, "clock");
  const clock = el(svg, "circle", { class: "m-clock", cx: 577, cy: 46, r: 9 });

  el(svg, "rect", { class: "m-inner", x: 50, y: 72, width: 255, height: 108, rx: 8 });
  el(svg, "text", { class: "m-label", x: 62, y: 94 }, "Control unit");
  const pills = PHASES.map((phase, index) => {
    const group = el(svg, "g", { class: "m-pill" });
    el(group, "rect", { x: 62 + index * 78, y: 103, width: 74, height: 22, rx: 11 });
    el(group, "text", { x: 99 + index * 78, y: 114 }, phase.toUpperCase());
    return group;
  });
  const opName = el(svg, "text", { class: "m-op", x: 62, y: 150 });
  const opMeaning = el(svg, "text", { class: "m-small", x: 62, y: 171 });

  el(svg, "rect", { class: "m-inner", x: 320, y: 72, width: 260, height: 108, rx: 8 });
  el(svg, "text", { class: "m-label", x: 332, y: 94 }, "Registers");
  const registerRows = [["a", "A"], ["b", "B"], ["x", "X"], ["pc", "Next"]].map(([key, label], row) => {
    const y = 112 + row * 19;
    el(svg, "text", { class: "m-reg-label", x: 332, y }, label);
    const bits = Array.from({ length: 8 }, (_, bit) => el(svg, "circle", { class: "m-reg-bit", cx: 384 + bit * 17, cy: y - 5, r: 6 }));
    const value = el(svg, "text", { class: "m-reg-value", x: 570, y }, "0");
    return { key, bits, value };
  });

  const aluBox = el(svg, "rect", { class: "m-inner m-alu", x: 50, y: 192, width: 530, height: 98, rx: 8 });
  el(svg, "text", { class: "m-label", x: 62, y: 212 }, "ALU: 8 adders, 40 gates");
  const aluText = el(svg, "text", { class: "m-small m-alu-text", x: 568, y: 212, "text-anchor": "end" });
  const GATE_SHAPES = {
    and: "M0 0 H8 A6 6 0 0 1 8 12 H0 Z",
    or: "M0 0 Q9 0 16 6 Q9 12 0 12 Q4 6 0 0 Z",
    xor: "M2 0 Q11 0 16 6 Q11 12 2 12 Q6 6 2 0 Z M-2 0 Q2 6 -2 12",
  };
  // Each adder's five gates, in the order fullAdderGates names them.
  const GATE_LAYOUT = [["oneOfTwo", "xor", 0, 0], ["both", "and", 1, 0], ["carried", "and", 2, 0], ["sum", "xor", 0, 1], ["carry", "or", 1, 1]];
  const adders = Array.from({ length: 8 }, (_, column) => {
    const bit = 7 - column; // The 1s column is on the right, as on paper.
    const left = 70 + column * 63;
    el(svg, "rect", { class: "m-adder", x: left, y: 222, width: 56, height: 58, rx: 5 });
    const gates = {};
    for (const [name, shape, gx, gy] of GATE_LAYOUT) {
      gates[name] = el(svg, "path", { class: "m-gate", d: GATE_SHAPES[shape], transform: `translate(${left + 5 + gx * 17 + (gy ? 8 : 0)} ${230 + gy * 22})` });
    }
    const carry = column > 0 ? el(svg, "line", { class: "m-carry", x1: left - 7, y1: 251, x2: left, y2: 251 }) : null;
    return { bit, gates, carry };
  });

  // Memory: every number in it, shown as its 0s and 1s.
  el(svg, "text", { class: "m-title", x: 700, y: 56 }, "Memory (RAM)");
  for (const [label, kind, x] of [["program", "program", 1050], ["data", "data", 1150]]) {
    el(svg, "rect", { class: `m-ram-bit on ${kind}`, x, y: 42, width: 12, height: 12 });
    el(svg, "text", { class: "m-small", x: x + 18, y: 53 }, label);
  }
  const ramShown = new Uint8Array(RAM_SIZE);
  const ramBytes = Array.from({ length: RAM_SIZE }, (_, address) => {
    const row = Math.floor(address / 8);
    const x = 700 + (address % 8) * 66;
    const y = 72 + row * 15.5;
    const kind = address < DATA ? "program" : "data";
    const frame = el(svg, "rect", { class: "m-byte", x: x - 2, y: y - 2, width: 64, height: 15, rx: 2 });
    const bits = Array.from({ length: 8 }, (_, bit) => el(svg, "rect", { class: `m-ram-bit ${kind}`, x: x + bit * 7.6, y, width: 6.6, height: 11, rx: 1 }));
    return { frame, bits };
  });

  // Storage, with the programs it keeps.
  el(svg, "text", { class: "m-title", x: 50, y: 428 }, "Storage");
  el(svg, "text", { class: "m-small", x: 50, y: 452 }, "keeps programs with the power off");
  const files = Object.fromEntries(PROGRAM_NAMES.map((name, index) => {
    const group = el(svg, "g", { class: "m-file" });
    el(group, "rect", { x: 52, y: 470 + index * 30, width: 13, height: 17, rx: 2 });
    el(group, "text", { x: 76, y: 484 + index * 30 }, name);
    return [name, group];
  }));

  // Screen: 8 rows of 8 pixels, each row one number in memory.
  el(svg, "text", { class: "m-screen-title", x: 510, y: 399 }, "Screen");
  const pixels = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => (
    el(svg, "rect", { class: "m-pixel", x: 402 + column * 27, y: 410 + row * 27, width: 25, height: 25, rx: 3 })
  )));
  const screenShown = new Uint8Array(8);

  el(svg, "text", { class: "m-title m-title-small", x: 740, y: 425 }, "Number display");
  el(svg, "rect", { class: "m-display", x: 740, y: 440, width: 240, height: 88, rx: 8 });
  const displayValue = el(svg, "text", { class: "m-display-value", x: 860, y: 486 }, "0");

  const speedLines = [0, 1, 2, 3].map((line) => el(svg, "text", { class: "m-speed", x: 1040, y: 425 + line * 26 }));

  // Numbers travelling on the bus, shown in slow motion.
  const packetLayer = el(svg, "g");
  let packets = [];

  // ---- Showing what happened ----
  let hot = new Set();
  function setHot(next) {
    for (const element of hot) if (!next.has(element)) element.classList.remove("hot");
    for (const element of next) if (!hot.has(element)) element.classList.add("hot");
    hot = next;
  }

  function lightTransfer(from, to, lit) {
    const [low, high] = [PARTS[from].stub, PARTS[to].stub].sort((a, b) => a - b);
    lit.add(stubs[from]).add(stubs[to]).add(boxes[from]).add(boxes[to]);
    for (const segment of segments) if (segment.from >= low && segment.to <= high) lit.add(segment.line);
  }

  function renderByte(address) {
    ramBytes[address].bits.forEach((bit, index) => bit.classList.toggle("on", Boolean(ramShown[address] & (0x80 >> index))));
  }

  function renderScreen() {
    pixels.forEach((row, index) => row.forEach((pixel, column) => pixel.classList.toggle("on", Boolean(screenShown[index] & (0x80 >> column)))));
  }

  function applyWrite({ address, value }) {
    if (address < RAM_SIZE) {
      ramShown[address] = value;
      renderByte(address);
    } else if (address < DISPLAY) {
      screenShown[address - SCREEN] = value;
      renderScreen();
    } else if (address === DISPLAY) {
      displayValue.textContent = value;
    }
  }

  function renderRegisters(values) {
    for (const { key, bits, value } of registerRows) {
      bits.forEach((bit, index) => bit.classList.toggle("on", Boolean(values[key] & (0x80 >> index))));
      value.textContent = values[key];
    }
  }

  function renderAlu(event) {
    const result = event?.alu;
    for (const adder of adders) {
      const column = result?.columns[adder.bit];
      for (const [name, gate] of Object.entries(adder.gates)) gate.classList.toggle("on", Boolean(column?.[name]));
      // The wire on an adder's left carries its carry out to the next column.
      adder.carry?.classList.toggle("on", Boolean(column?.carry));
    }
    if (!result) {
      aluText.textContent = "";
    } else if (event.key === "CMP" || event.key === "CPX") {
      aluText.textContent = `compare ${result.a} and ${result.b}`;
    } else {
      aluText.textContent = `${result.a} ${result.subtract ? "−" : "+"} ${result.b} = ${result.result}`;
    }
  }

  function deviceOf(address) {
    return address < RAM_SIZE ? "ram" : address < DISPLAY ? "screen" : "display";
  }

  // Lights up and applies what `events` did. `phases` picks which parts of an instruction to show.
  function show(events, phases, lit) {
    let last = null;
    for (const event of events) {
      if (event.kind === "load") {
        lightTransfer("storage", "ram", lit);
        lit.add(ramBytes[event.address].frame);
        applyWrite(event);
        continue;
      }
      last = event;
      if (phases.fetch) {
        lightTransfer("ram", "cpu", lit);
        lit.add(ramBytes[event.pc].frame).add(ramBytes[(event.pc + 1) % RAM_SIZE].frame).add(clock);
      }
      if (phases.execute) {
        for (const read of event.reads) {
          lightTransfer(deviceOf(read.address), "cpu", lit);
          if (read.address < RAM_SIZE) lit.add(ramBytes[read.address].frame);
        }
        for (const write of event.writes) {
          lightTransfer("cpu", deviceOf(write.address), lit);
          if (write.address < RAM_SIZE) lit.add(ramBytes[write.address].frame);
          applyWrite(write);
        }
        if (event.alu) lit.add(aluBox);
      }
    }
    if (!last) return;
    PHASES.forEach((phase, index) => { if (phases[phase]) lit.add(pills[index]); });
    const decoded = phases.decode || phases.execute;
    opName.textContent = decoded ? last.name : `${last.code}  ${last.operand}`;
    opMeaning.textContent = decoded ? last.meaning : "not decoded yet";
    renderRegisters(phases.execute ? last.after : last.before);
    if (phases.execute && last.alu) renderAlu(last);
    else if (!phases.execute || events.every((event) => !event.alu)) {
      // Keep the gates of the last sum lit while running fast; clear them for a new step in slow motion.
      if (slow) renderAlu(null);
    }
  }

  function sendPacket(from, to, label, now) {
    const start = PARTS[from];
    const end = PARTS[to];
    const edge = (part) => (part.y > BUS_Y ? part.y : part.y + part.h);
    const points = [[start.stub, edge(start)], [start.stub, BUS_Y], [end.stub, BUS_Y], [end.stub, edge(end)]];
    const group = el(packetLayer, "g", { class: "m-packet" });
    const box = el(group, "rect", { height: 30, rx: 15, y: -15 });
    const text = el(group, "text", { x: 0, y: 1 }, label);
    const width = Math.max(44, text.getComputedTextLength() + 24);
    box.setAttribute("width", width);
    box.setAttribute("x", -width / 2);
    packets.push({ group, points, start: now, duration: SLOW_PHASE_MS * 0.75 });
  }

  function movePackets(now) {
    packets = packets.filter((packet) => {
      const t = Math.min(1, (now - packet.start) / packet.duration);
      const lengths = packet.points.slice(1).map(([x, y], index) => Math.hypot(x - packet.points[index][0], y - packet.points[index][1]));
      let distance = lengths.reduce((total, length) => total + length, 0) * (t * t * (3 - 2 * t));
      let index = 0;
      while (index < lengths.length - 1 && distance > lengths[index]) distance -= lengths[index++];
      const [x0, y0] = packet.points[index];
      const [x1, y1] = packet.points[index + 1];
      const along = lengths[index] ? distance / lengths[index] : 0;
      packet.group.setAttribute("transform", `translate(${x0 + (x1 - x0) * along} ${y0 + (y1 - y0) * along})`);
      if (t >= 1 && now - packet.start > packet.duration + 250) {
        packet.group.remove();
        return false;
      }
      return true;
    });
  }

  function clearPackets() {
    packetLayer.replaceChildren();
    packets = [];
  }

  // ---- Running the tasks ----
  const cpu = createCpu(new Uint8Array(MEMORY_SIZE));
  let tasks = [];
  let taskIndex = 0;
  let loadQueue = [];
  let stepsThisTask = 0;
  let totalSteps = 0;
  let pauseUntil = 0;
  let afterPause = null;
  let budget = 0;
  let slow = false;
  let slowStep = null;
  let frameId = null;
  let lastTime = 0;

  function renderTasks() {
    taskList.replaceChildren(...tasks.map((task) => {
      const item = document.createElement("li");
      item.className = `task ${task.state}`;
      const mark = document.createElement("span");
      mark.className = "task-mark";
      mark.textContent = { waiting: "○", running: "▶", done: "✓" }[task.state];
      const label = document.createElement("span");
      label.textContent = task.label;
      const steps = document.createElement("span");
      steps.className = "task-steps";
      steps.textContent = task.state === "done" ? `${task.steps.toLocaleString("en")} steps` : "";
      item.append(mark, label, steps);
      return item;
    }));
  }

  function renderSpeed() {
    const perSecond = slow ? 1000 / (SLOW_PHASE_MS * PHASES.length) : FAST_STEPS_PER_SECOND;
    speedLines[0].textContent = slow ? `Here: 1 step every ${Math.round(1 / perSecond)} seconds` : `Here: ${perSecond} steps a second`;
    speedLines[1].textContent = "A real chip: billions a second";
    speedLines[2].textContent = "So this is slowed down";
    speedLines[3].textContent = `${roughly(REAL_CHIP_STEPS_PER_SECOND / perSecond)} times`;
  }

  function beginTask() {
    const task = tasks[taskIndex];
    task.state = "running";
    loadQueue = [...task.load];
    resetCpu(cpu);
    stepsThisTask = 0;
    for (const [name, file] of Object.entries(files)) file.classList.toggle("current", name === task.program);
    renderTasks();
  }

  function beginRound() {
    tasks = makeTasks({ ...inputs(), bars: shuffledBars() }).map((task) => ({ ...task, state: "waiting" }));
    taskIndex = 0;
    // A fresh screen and display for each round.
    for (let address = SCREEN; address <= DISPLAY; address++) cpu.memory[address] = 0;
    screenShown.fill(0);
    renderScreen();
    displayValue.textContent = "0";
    beginTask();
  }

  function taskFinished(now) {
    const task = tasks[taskIndex];
    task.state = "done";
    task.steps = stepsThisTask;
    renderTasks();
    pauseUntil = now + PAUSE_MS[slow ? "slow" : "fast"];
    afterPause = () => {
      taskIndex++;
      if (taskIndex >= tasks.length) beginRound();
      else beginTask();
    };
  }

  function nextEvent() {
    if (loadQueue.length) {
      const { address, value } = loadQueue.shift();
      cpu.memory[address] = value;
      return { kind: "load", address, value };
    }
    stepsThisTask++;
    totalSteps++;
    return step(cpu);
  }

  function fastFrame(now, dt) {
    budget = Math.min(budget + dt * FAST_STEPS_PER_SECOND, 4);
    const events = [];
    while (budget > 0) {
      const event = nextEvent();
      events.push(event);
      budget -= event.kind === "load" ? LOAD_COST : 1;
      if (event.halted) break;
    }
    if (!events.length) return; // No time has passed yet, as on the very first frame.
    const lit = new Set();
    show(events, ALL_PHASES, lit);
    setHot(lit);
    if (events.at(-1).halted) {
      budget = 0;
      taskFinished(now);
    }
  }

  function showSlowPhase(now) {
    const { event, phase } = slowStep;
    const name = PHASES[phase];
    const lit = new Set();
    show([event], { [name]: true }, lit);
    setHot(lit);
    phaseText.textContent = [explainFetch, explainDecode, explainExecute][phase](event);
    if (name === "fetch") sendPacket("ram", "cpu", `${event.code}  ${event.operand}`, now);
    if (name === "execute") {
      for (const read of event.reads) sendPacket(deviceOf(read.address), "cpu", String(read.value), now);
      for (const write of event.writes) sendPacket("cpu", deviceOf(write.address), String(write.value), now);
    }
  }

  function slowFrame(now, dt) {
    if (!slowStep && loadQueue.length) {
      // Loading a program is shown quickly even in slow motion.
      budget = Math.min(budget + dt * SLOW_LOAD_BYTES_PER_SECOND, 4);
      const events = [];
      while (budget >= 1 && loadQueue.length) {
        events.push(nextEvent());
        budget -= 1;
      }
      const lit = new Set();
      show(events, ALL_PHASES, lit);
      setHot(lit);
      phaseText.textContent = `Storage copies the "${tasks[taskIndex].program}" program into memory, one number at a time, over the bus.`;
      return;
    }
    if (!slowStep) {
      slowStep = { event: nextEvent(), phase: 0, started: now };
      showSlowPhase(now);
    } else if (now - slowStep.started >= SLOW_PHASE_MS) {
      if (slowStep.phase < PHASES.length - 1) {
        slowStep.phase++;
        slowStep.started = now;
        showSlowPhase(now);
      } else {
        const finished = slowStep.event.halted;
        slowStep = null;
        if (finished) taskFinished(now);
      }
    }
  }

  function frame(now) {
    frameId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    movePackets(now);
    if (now < pauseUntil) {
      setHot(new Set());
      return;
    }
    if (afterPause) {
      const run = afterPause;
      afterPause = null;
      run();
    }
    if (slow) slowFrame(now, dt);
    else fastFrame(now, dt);
    stepCount.textContent = `Steps run: ${totalSteps.toLocaleString("en")}`;
  }

  function stop() {
    cancelAnimationFrame(frameId);
    frameId = null;
  }

  function finishSlowStep() {
    // Show the rest of a half-shown instruction at once, so nothing is skipped.
    if (!slowStep) return;
    const { event } = slowStep;
    slowStep = null;
    show([event], ALL_PHASES, new Set());
    if (event.halted) taskFinished(performance.now());
  }

  renderRegisters(cpu);
  renderSpeed();

  return {
    // Starts a fresh round, with the students' latest numbers and letter.
    start() {
      stop();
      clearPackets();
      slowStep = null;
      pauseUntil = 0;
      afterPause = null;
      budget = 0;
      beginRound();
      lastTime = performance.now();
      frameId = requestAnimationFrame(frame);
    },
    stop() {
      stop();
      finishSlowStep();
      clearPackets();
      setHot(new Set());
    },
    toggleSlow() {
      if (slow) finishSlowStep();
      slow = !slow;
      budget = 0;
      clearPackets();
      phaseText.hidden = !slow;
      phaseText.textContent = "";
      renderSpeed();
      return slow;
    },
    get slow() {
      return slow;
    },
  };
}

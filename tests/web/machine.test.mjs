import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISPLAY, FONT, RAM_SIZE, SCREEN, SMILEY, alu, assemble, barByte, createCpu, explainDecode,
  explainExecute, explainFetch, letterBytes, makeTasks, pictureBytes, shuffledBars, step,
} from "../../web/machine-core.mjs";

// Loads a task the way storage does, then runs it to the end.
function run(task, cpu = createCpu()) {
  for (const { address, value } of task.load) cpu.memory[address] = value;
  Object.assign(cpu, { a: 0, b: 0, x: 0, pc: 0, halted: false });
  const events = [];
  while (!cpu.halted) {
    events.push(step(cpu));
    assert.ok(events.length < 5000, `${task.label} never finished`);
  }
  return { cpu, events };
}

const screenOf = (cpu) => [...cpu.memory.slice(SCREEN, SCREEN + 8)];
const shown = (events) => events.flatMap((event) => event.writes).filter((write) => write.address === DISPLAY).map((write) => write.value);
const tasksFor = (inputs) => Object.fromEntries(makeTasks({ letter: "M", bars: shuffledBars(() => 0.3), ...inputs }).map((task) => [task.id, task]));

test("the ALU's gates add and subtract every pair of 8-bit numbers correctly", () => {
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const sum = alu(a, b);
      assert.equal(sum.result + 256 * sum.carry, a + b);
      const difference = alu(a, b, true);
      assert.equal(difference.result, (a - b + 256) % 256);
      assert.equal(difference.carry, a >= b ? 1 : 0, "carry means no borrow, so A was at least B");
    }
  }
});

test("adding shows the students' sum on the number display", () => {
  for (const [a, b] of [[6, 7], [15, 15], [0, 0], [9, 8]]) {
    const { events } = run(tasksFor({ a, b }).add);
    assert.deepEqual(shown(events), [a + b]);
  }
});

test("multiplying adds A to a running total, B times", () => {
  for (const [a, b] of [[6, 7], [15, 15], [3, 0], [0, 5], [1, 1]]) {
    const { events } = run(tasksFor({ a, b }).multiply);
    const totals = shown(events);
    assert.equal(totals.at(-1), a * b);
    assert.equal(totals.length, b + 1, "the display starts at 0, then shows each new total");
    assert.equal(events.filter((event) => event.key === "ADD").length, b);
  }
});

test("counting shows every number from 0 to 99, using the adder each time", () => {
  const { events } = run(tasksFor({ a: 6, b: 7 }).count);
  assert.deepEqual(shown(events), Array.from({ length: 100 }, (_, number) => number));
});

test("the letter and the smiley end up on the screen", () => {
  assert.deepEqual(screenOf(run(tasksFor({ a: 6, b: 7 }).letter).cpu), letterBytes("M"));
  assert.deepEqual(screenOf(run(tasksFor({ a: 6, b: 7 }).smiley).cpu), pictureBytes(SMILEY));
});

test("sorting puts the bars in order, shortest first, for any shuffle", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8].map(barByte);
  for (const seed of [0, 0.1, 0.5, 0.9, 0.99]) {
    let state = seed;
    const random = () => (state = (state * 9301 + 0.49297) % 1);
    const bars = shuffledBars(random);
    assert.deepEqual([...bars].sort((x, y) => x - y), sorted, "a shuffle of the same 8 bars");
    const task = makeTasks({ a: 6, b: 7, letter: "A", bars }).find((item) => item.id === "sort");
    const { cpu, events } = run(task);
    assert.deepEqual(screenOf(cpu), sorted);
    assert.ok(events.some((event) => event.key === "CMP" && event.alu));
  }
  // A longer bar is always a bigger number, which is why sorting numbers sorts bars.
  for (let length = 1; length < 8; length++) assert.ok(barByte(length) < barByte(length + 1));
});

test("every program fits in the program part of memory and keeps to its own addresses", () => {
  for (const task of makeTasks({ a: 15, b: 15, letter: "W", bars: shuffledBars() })) {
    for (const { address } of task.load) assert.ok(address < RAM_SIZE, `${task.label} loads into memory only`);
    const program = task.load.filter(({ address }) => address < 0x50);
    assert.ok(program.length <= 0x50);
    const { events } = run(task);
    for (const event of events) {
      for (const access of [...event.reads, ...event.writes]) assert.ok(access.address <= DISPLAY, `${task.label} stays inside the machine`);
    }
  }
});

test("every step has a sentence for fetch, decode and execute", () => {
  for (const task of makeTasks({ a: 6, b: 7, letter: "M", bars: shuffledBars() })) {
    for (const event of run(task).events) {
      for (const explain of [explainFetch, explainDecode, explainExecute]) {
        const sentence = explain(event);
        assert.ok(sentence && !sentence.includes("undefined") && !sentence.includes("NaN"), `${event.key}: ${sentence}`);
      }
    }
  }
});

test("the font has every letter, 5 pixels wide and 7 tall", () => {
  assert.equal(Object.keys(FONT).join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  for (const [letter, rows] of Object.entries(FONT)) {
    assert.equal(rows.length, 7, letter);
    for (const row of rows) assert.match(row, /^[.#]{5}$/, letter);
    assert.equal(letterBytes(letter).length, 8);
  }
});

test("the assembler turns labels into addresses", () => {
  assert.deepEqual(assemble([["SETA", 1], "here:", ["JMP", "here"]]), [1, 1, 32, 2]);
  assert.throws(() => assemble([["JMP", "nowhere"]]));
  assert.throws(() => assemble([["FLY"]]));
});

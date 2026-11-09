// A tiny computer that really runs: a CPU with three registers and an ALU built from the
// adders of "Doing math", memory, an 8 x 8 screen and a number display, all on one bus.
// Programs are numbers in memory, like on a real machine. No drawing code here, so every
// task can be tested.

import { fullAdderGates } from "./computer-core.mjs";

export const MEMORY_SIZE = 256;
export const RAM_SIZE = 0x70; // Addresses 0-111 are memory: the program from 0, the data from 80.
export const DATA = 0x50;
export const SCREEN = 0x70; // 8 addresses, one per screen row. The left pixel is the top bit.
export const DISPLAY = 0x78; // The number display shows whatever is written here.

const VARS = { x: 0x50, y: 0x51, product: 0x52, count: 0x53, swapped: 0x54, picture: 0x58 };

export function deviceAt(address) {
  if (address < RAM_SIZE) return "ram";
  if (address < DISPLAY) return "screen";
  return "display";
}

function where(address) {
  const device = deviceAt(address);
  if (device === "screen") return `screen row ${address - SCREEN + 1}`;
  if (device === "display") return "the number display";
  return `memory ${address}`;
}

// Every instruction is two numbers: what to do, then a number to do it with.
// `name` and `meaning` are what the control unit shows once it has decoded it.
const OPS = {
  SETA: { code: 1, name: "SET A", meaning: (n) => `A = ${n}` },
  SETB: { code: 2, name: "SET B", meaning: (n) => `B = ${n}` },
  SETX: { code: 3, name: "SET X", meaning: (n) => `X = ${n}` },
  LDA: { code: 4, name: "LOAD A", meaning: (n) => `A = ${where(n)}` },
  LDB: { code: 5, name: "LOAD B", meaning: (n) => `B = ${where(n)}` },
  STA: { code: 6, name: "STORE A", meaning: (n) => `${where(n)} = A` },
  LDAX: { code: 7, name: "LOAD A", meaning: (n) => `A = memory ${n} + X` },
  LDBX: { code: 8, name: "LOAD B", meaning: (n) => `B = memory ${n} + X` },
  STAX: { code: 9, name: "STORE A", meaning: (n) => `memory ${n} + X = A` },
  STBX: { code: 10, name: "STORE B", meaning: (n) => `memory ${n} + X = B` },
  ADD: { code: 16, name: "ADD", meaning: () => "A = A + B" },
  SUB: { code: 17, name: "SUBTRACT", meaning: () => "A = A − B" },
  CMP: { code: 18, name: "COMPARE", meaning: () => "is A bigger than B?" },
  INX: { code: 19, name: "ADD 1", meaning: () => "X = X + 1" },
  CPX: { code: 20, name: "COMPARE X", meaning: (n) => `is X ${n} yet?` },
  JMP: { code: 32, name: "JUMP", meaning: (n) => `go to ${n}` },
  JZ: { code: 33, name: "JUMP IF ZERO", meaning: (n) => `if the answer was 0, go to ${n}` },
  JNZ: { code: 34, name: "JUMP IF NOT 0", meaning: (n) => `if the answer wasn't 0, go to ${n}` },
  JNC: { code: 36, name: "JUMP IF SMALLER", meaning: (n) => `if A was smaller, go to ${n}` },
  HALT: { code: 255, name: "STOP", meaning: () => "the task is done" },
};

const BY_CODE = new Map(Object.entries(OPS).map(([key, op]) => [op.code, { key, ...op }]));

// Turns [instruction, number] pairs and "label:" strings into the numbers stored in memory.
export function assemble(lines) {
  const labels = {};
  let address = 0;
  for (const line of lines) {
    if (typeof line === "string") labels[line.replace(/:$/, "")] = address;
    else address += 2;
  }
  const bytes = [];
  for (const line of lines) {
    if (typeof line === "string") continue;
    const [key, operand = 0] = line;
    if (!OPS[key]) throw new Error(`Unknown instruction ${key}`);
    const value = typeof operand === "string" ? labels[operand] : operand;
    if (value === undefined) throw new Error(`Unknown label ${operand}`);
    bytes.push(OPS[key].code, value & 0xff);
  }
  return bytes;
}

// The ALU: 8 adders in a chain, from the 1s column up. To subtract, it adds the opposite of B
// plus 1, exactly as real chips do, so the same gates do both.
export function alu(a, b, subtract = false) {
  const input = subtract ? ~b & 0xff : b;
  let carry = subtract ? 1 : 0;
  const columns = [];
  for (let bit = 0; bit < 8; bit++) {
    const gates = fullAdderGates((a >> bit) & 1, (input >> bit) & 1, carry);
    columns.push({ bit, carryIn: carry, ...gates });
    carry = gates.carry;
  }
  const result = columns.reduce((total, column) => total | (column.sum << column.bit), 0);
  return { a, b, subtract, result, carry, zero: result === 0, columns };
}

export function createCpu(memory = new Uint8Array(MEMORY_SIZE)) {
  return { a: 0, b: 0, x: 0, pc: 0, zero: false, carry: false, halted: false, memory };
}

export function resetCpu(cpu) {
  Object.assign(cpu, { a: 0, b: 0, x: 0, pc: 0, zero: false, carry: false, halted: false });
}

function registers(cpu) {
  return { a: cpu.a, b: cpu.b, x: cpu.x, pc: cpu.pc, zero: cpu.zero, carry: cpu.carry };
}

// Fetch, decode and execute one instruction. Returns everything each part of the machine did,
// so the screen can show it.
export function step(cpu) {
  const pc = cpu.pc;
  const code = cpu.memory[pc];
  const operand = cpu.memory[(pc + 1) & 0xff];
  const op = BY_CODE.get(code) ?? BY_CODE.get(OPS.HALT.code);
  const event = {
    kind: "instruction", pc, code, operand, key: op.key, name: op.name, meaning: op.meaning(operand),
    reads: [], writes: [], alu: null, before: registers(cpu),
  };
  cpu.pc = (pc + 2) & 0xff;

  const read = (address) => {
    const value = cpu.memory[address & 0xff];
    event.reads.push({ address: address & 0xff, value, device: deviceAt(address & 0xff) });
    return value;
  };
  const write = (address, value) => {
    cpu.memory[address & 0xff] = value;
    event.writes.push({ address: address & 0xff, value, device: deviceAt(address & 0xff) });
  };
  const setA = (value) => {
    cpu.a = value;
    cpu.zero = value === 0;
  };
  const useAlu = (a, b, subtract) => {
    const result = alu(a, b, subtract);
    event.alu = result;
    cpu.carry = Boolean(result.carry);
    cpu.zero = result.zero;
    return result.result;
  };

  switch (op.key) {
    case "SETA": setA(operand); break;
    case "SETB": cpu.b = operand; break;
    case "SETX": cpu.x = operand; break;
    case "LDA": setA(read(operand)); break;
    case "LDB": cpu.b = read(operand); break;
    case "STA": write(operand, cpu.a); break;
    case "LDAX": setA(read(operand + cpu.x)); break;
    case "LDBX": cpu.b = read(operand + cpu.x); break;
    case "STAX": write(operand + cpu.x, cpu.a); break;
    case "STBX": write(operand + cpu.x, cpu.b); break;
    case "ADD": cpu.a = useAlu(cpu.a, cpu.b, false); break;
    case "SUB": cpu.a = useAlu(cpu.a, cpu.b, true); break;
    case "CMP": useAlu(cpu.a, cpu.b, true); break;
    case "INX": cpu.x = useAlu(cpu.x, 1, false); break;
    case "CPX": useAlu(cpu.x, operand, true); break;
    case "JMP": cpu.pc = operand; break;
    case "JZ": if (cpu.zero) cpu.pc = operand; break;
    case "JNZ": if (!cpu.zero) cpu.pc = operand; break;
    case "JNC": if (!cpu.carry) cpu.pc = operand; break;
    default:
      cpu.halted = true;
      cpu.pc = pc;
  }
  event.jumped = !cpu.halted && cpu.pc !== ((pc + 2) & 0xff);
  event.halted = cpu.halted;
  event.after = registers(cpu);
  return event;
}

// One sentence per phase, for slow motion.
export function explainFetch(event) {
  return `Fetch: the CPU asks memory for the instruction at ${event.pc}. It comes over the bus as two numbers, ${event.code} and ${event.operand}.`;
}

export function explainDecode(event) {
  return `Decode: the control unit reads ${event.code} as "${event.name}": ${event.meaning}.`;
}

export function explainExecute(event) {
  const { before, after, alu: sum } = event;
  const [read] = event.reads;
  const [written] = event.writes;
  switch (event.key) {
    case "SETA": case "SETB": case "SETX":
      return `Execute: the number ${event.operand} goes into register ${event.key.at(-1)}.`;
    case "LDA": case "LDB": case "LDAX": case "LDBX":
      return `Execute: ${read.value} comes over the bus from ${where(read.address)} into register ${event.key[2]}.`;
    case "STA": case "STAX": case "STBX":
      return `Execute: ${written.value} goes over the bus from register ${event.key[2]} to ${where(written.address)}.`;
    case "ADD":
      return `Execute: the ALU's gates add ${sum.a} + ${sum.b} = ${sum.result}.`;
    case "SUB":
      return `Execute: the ALU's gates work out ${sum.a} − ${sum.b} = ${sum.result}.`;
    case "CMP": {
      const verdict = sum.a > sum.b ? "A is bigger" : sum.a === sum.b ? "they are the same" : "B is bigger";
      return `Execute: the ALU compares ${sum.a} and ${sum.b}: ${verdict}.`;
    }
    case "INX":
      return `Execute: the ALU adds 1 to X, making ${after.x}.`;
    case "CPX":
      return before.x === event.operand
        ? `Execute: X has reached ${event.operand}.`
        : `Execute: X is ${before.x}, not ${event.operand} yet.`;
    case "JMP":
      return `Execute: jump back to ${event.operand} to go round again.`;
    case "JZ": case "JNZ": case "JNC":
      return event.jumped ? `Execute: yes, so jump to ${event.operand}.` : "Execute: no, so carry on to the next instruction.";
    default:
      return "Execute: stop. This task is done.";
  }
}

// Letters for "Show the letter", 5 pixels wide and 7 tall.
export const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
};

export const SMILEY = [
  "..####..",
  ".#....#.",
  "#.#..#.#",
  "#......#",
  "#.#..#.#",
  "#..##..#",
  ".#....#.",
  "..####..",
];

// A picture as 8 numbers, one per row, with "#" as a lit pixel.
export function pictureBytes(rows) {
  return rows.map((row) => [...row].reduce((byte, pixel, column) => byte | (pixel === "#" ? 0x80 >> column : 0), 0));
}

export function letterBytes(letter) {
  const glyph = FONT[letter] ?? FONT.A;
  return [...pictureBytes(glyph.map((row) => `.${row}..`)), 0];
}

// A bar of `length` pixels from the left is a number with that many 1s at the top, so a longer
// bar is always a bigger number, and sorting the numbers sorts the bars.
export function barByte(length) {
  return (0xff << (8 - length)) & 0xff;
}

export function shuffledBars(random = Math.random) {
  const lengths = [1, 2, 3, 4, 5, 6, 7, 8];
  for (let index = lengths.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [lengths[index], lengths[other]] = [lengths[other], lengths[index]];
  }
  return lengths.map(barByte);
}

const COPY_PICTURE = [
  ["SETX", 0],
  "copy:",
  ["LDAX", VARS.picture],
  ["STAX", SCREEN],
  ["INX"],
  ["CPX", 8],
  ["JNZ", "copy"],
];

const PROGRAMS = {
  add: [
    ["LDA", VARS.x],
    ["LDB", VARS.y],
    ["ADD"],
    ["STA", DISPLAY],
    ["HALT"],
  ],
  // A × B by adding A to a running total, B times.
  multiply: [
    ["SETA", 0],
    ["STA", VARS.product],
    ["STA", DISPLAY],
    ["LDA", VARS.y],
    ["STA", VARS.count],
    "loop:",
    ["LDA", VARS.count],
    ["JZ", "done"],
    ["LDA", VARS.product],
    ["LDB", VARS.x],
    ["ADD"],
    ["STA", VARS.product],
    ["STA", DISPLAY],
    ["LDA", VARS.count],
    ["SETB", 1],
    ["SUB"],
    ["STA", VARS.count],
    ["JMP", "loop"],
    "done:",
    ["HALT"],
  ],
  count: [
    ["SETA", 0],
    "loop:",
    ["STA", DISPLAY],
    ["SETB", 1],
    ["ADD"],
    ["SETB", 100],
    ["CMP"],
    ["JNZ", "loop"],
    ["HALT"],
  ],
  picture: [...COPY_PICTURE, ["HALT"]],
  // Put the bars on the screen, then bubble sort them where they are: compare each pair of rows
  // and swap them if the top one is longer, until a whole pass needs no swaps.
  sort: [
    ...COPY_PICTURE,
    "outer:",
    ["SETA", 0],
    ["STA", VARS.swapped],
    ["SETX", 0],
    "inner:",
    ["LDAX", SCREEN],
    ["LDBX", SCREEN + 1],
    ["CMP"],
    ["JZ", "next"],
    ["JNC", "next"],
    ["STAX", SCREEN + 1],
    ["STBX", SCREEN],
    ["SETA", 1],
    ["STA", VARS.swapped],
    "next:",
    ["INX"],
    ["CPX", 7],
    ["JNZ", "inner"],
    ["LDA", VARS.swapped],
    ["JNZ", "outer"],
    ["HALT"],
  ],
};

const placed = (address, bytes) => bytes.map((value, index) => ({ address: address + index, value }));

// The tasks, in the order the machine runs them. `load` is what storage copies into memory first.
export function makeTasks({ a, b, letter, bars }) {
  const tasks = [
    { id: "add", label: `Add ${a} + ${b}`, program: "add", data: placed(VARS.x, [a, b]) },
    { id: "multiply", label: `Multiply ${a} × ${b} by adding`, program: "multiply", data: placed(VARS.x, [a, b]) },
    { id: "count", label: "Count to 99", program: "count", data: [] },
    { id: "letter", label: `Show the letter ${letter}`, program: "picture", data: placed(VARS.picture, letterBytes(letter)) },
    { id: "smiley", label: "Draw a smiley", program: "picture", data: placed(VARS.picture, pictureBytes(SMILEY)) },
    { id: "sort", label: "Sort 8 bars by length", program: "sort", data: placed(VARS.picture, bars) },
  ];
  return tasks.map((task) => ({ ...task, load: [...placed(0, assemble(PROGRAMS[task.program])), ...task.data] }));
}

export const PROGRAM_NAMES = Object.keys(PROGRAMS);

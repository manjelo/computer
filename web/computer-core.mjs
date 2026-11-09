// Binary and logic rules, separate from the drawing so they can be tested on their own.

export const PLACES = [128, 64, 32, 16, 8, 4, 2, 1];

export function bitsToNumber(bits, places = PLACES) {
  return bits.reduce((total, bit, index) => total + (bit ? places[index] : 0), 0);
}

export function numberToBits(number) {
  return PLACES.map((place) => (number & place ? 1 : 0));
}

// Only visible characters count as a letter. The rest are computer control codes.
export function numberToChar(number) {
  return number >= 33 && number <= 126 ? String.fromCharCode(number) : null;
}

export function sumText(bits) {
  const parts = PLACES.filter((_, index) => bits[index]);
  return parts.length > 1 ? `${parts.join(" + ")} = ${bitsToNumber(bits)}` : "";
}

export function matchesGoal(bits, goal) {
  return goal !== null && bitsToNumber(bits) === goal.charCodeAt(0);
}

export const GATES = {
  and: (a, b) => a && b,
  or: (a, b) => a || b,
  // "One or the other, but not both". Only used inside the adder, not shown as its own gate.
  xor: (a, b) => a !== b,
};

export const STEPS = ["binary", "gates", "paper", "adder", "race", "close"];

// Doing math: two numbers of 4 switches each.
export const ADD_PLACES = [8, 4, 2, 1];

// One column of the sum, built from five gates the way a chip does it: a "full adder".
// Returns what each gate outputs, so the machine on the last screen can light them up.
export function fullAdderGates(a, b, carryIn) {
  const [x, y, c] = [a, b, carryIn].map(Boolean);
  const oneOfTwo = GATES.xor(x, y);
  const both = GATES.and(x, y);
  const carried = GATES.and(oneOfTwo, c);
  return {
    oneOfTwo: Number(oneOfTwo),
    both: Number(both),
    carried: Number(carried),
    sum: Number(GATES.xor(oneOfTwo, c)),
    carry: Number(GATES.or(both, carried)),
  };
}

export function fullAdder(a, b, carryIn) {
  const { sum, carry } = fullAdderGates(a, b, carryIn);
  return { sum, carry };
}

// Columns from the right (the 1s) to the left, as a person adds on paper. `carry` is what is
// left over at the end, which becomes the 16s digit.
export function addColumns(aBits, bBits) {
  const columns = [];
  let carry = 0;
  for (let index = aBits.length - 1; index >= 0; index--) {
    const a = aBits[index];
    const b = bBits[index];
    const result = fullAdder(a, b, carry);
    columns.push({ index, place: ADD_PLACES[index], a, b, carryIn: carry, total: a + b + carry, ...result });
    carry = result.carry;
  }
  return { columns, carry };
}

// Each press of Space on the paper screen: one column at a time, then any last carry, then the answer.
export function paperStages(aBits, bBits) {
  const { columns, carry } = addColumns(aBits, bBits);
  return [
    { kind: "start" },
    ...columns.map((column) => ({ kind: "column", column })),
    ...(carry ? [{ kind: "carry" }] : []),
    { kind: "done" },
  ];
}

const COLUMN_RESULT = [
  "Write 0.",
  "Write 1.",
  "In binary, 2 is written 10. Write 0 and carry the 1 to the next column.",
  "In binary, 3 is written 11. Write 1 and carry the 1 to the next column.",
];

export function paperText(stage, a, b) {
  switch (stage.kind) {
    case "start":
      return { title: "Pick two numbers with the switches", text: "Then add them one column at a time, starting from the right, just like on paper." };
    case "column": {
      const { place, a: x, b: y, carryIn, total } = stage.column;
      const sum = carryIn ? `${x} + ${y} + the carried 1 = ${total}` : `${x} + ${y} = ${total}`;
      return { title: `The ${place}s column: ${sum}`, text: COLUMN_RESULT[total] };
    }
    case "carry":
      return { title: "The last carry starts a new column", text: "Nothing is left to add, so the 1 goes in the 16s column." };
    default:
      return { title: `${a} + ${b} = ${a + b}`, text: "The same answer you would get, using only 0s and 1s." };
  }
}

// Race the computer: a student presses Space as fast as they can while the laptop counts.
export const RACE_SECONDS = 5;
// Space is ignored this long after the race, so a student still pressing doesn't skip the result.
export const RACE_LOCK_MS = 2000;

export function newRace() {
  return { phase: "ready", you: 0, laptop: 0, startedAt: 0, endedAt: 0 };
}

// The clock starts at the first press, and presses after the time is up don't count.
export function pressSpace(race, now) {
  if (race.phase === "ready") return { ...race, phase: "running", you: 1, startedAt: now };
  if (race.phase === "running" && now - race.startedAt < RACE_SECONDS * 1000) {
    return { ...race, you: race.you + 1 };
  }
  return race;
}

// The laptop reports its count as it goes. The race is over when it says it is done.
export function laptopCounted(race, count, done, now) {
  if (race.phase !== "running") return race;
  return done ? { ...race, laptop: count, phase: "done", endedAt: now } : { ...race, laptop: count };
}

export function spaceMovesOn(race, now) {
  return race.phase === "done" && now - race.endedAt >= RACE_LOCK_MS;
}

export function secondsLeft(race, now) {
  if (race.phase === "ready") return RACE_SECONDS;
  if (race.phase === "done") return 0;
  return Math.max(0, RACE_SECONDS - (now - race.startedAt) / 1000);
}

// How many times faster the laptop counted, in words: "125 million", "1.7 billion".
export function timesFaster(you, laptop) {
  const ratio = laptop / Math.max(1, you);
  const short = (value) => (value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, ""));
  if (ratio >= 1e9) return `${short(ratio / 1e9)} billion`;
  if (ratio >= 1e6) return `${short(ratio / 1e6)} million`;
  return Math.round(ratio).toLocaleString("en");
}

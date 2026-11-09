// Binary and logic rules, separate from the drawing so they can be tested on their own.

export const PLACES = [128, 64, 32, 16, 8, 4, 2, 1];

export function bitsToNumber(bits) {
  return bits.reduce((total, bit, index) => total + (bit ? PLACES[index] : 0), 0);
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
};

export const STEPS = ["binary", "gates", "race", "close"];

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

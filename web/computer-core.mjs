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

export const STEPS = ["binary", "gates", "close"];

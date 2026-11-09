// Counts as fast as one part of the processor can, for as long as it is told, reporting as it goes.
// It runs apart from the page, so the student's key presses still register while it counts.

// Check the clock only every this many counts, so the time is spent counting. An uneven
// number, so the total on screen doesn't end in a row of zeros and look made up.
const BETWEEN_CLOCK_CHECKS = 99_991;

onmessage = ({ data }) => {
  const end = performance.now() + data.ms;
  let count = 0;
  let nextReport = 0;
  for (let now = performance.now(); now < end; now = performance.now()) {
    for (let i = 0; i < BETWEEN_CLOCK_CHECKS; i++) count++;
    if (now >= nextReport) {
      postMessage({ count, done: false });
      nextReport = now + 50;
    }
  }
  postMessage({ count, done: true });
};

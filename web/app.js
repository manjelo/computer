import { createAiTrack } from "./ai.js";
import { createDevTrack } from "./dev.js";
import { createComputerTrack } from "./computer.js";

const tracks = {
  ai: createAiTrack(),
  dev: createDevTrack(),
  computer: createComputerTrack(),
};
const order = ["ai", "dev", "computer"];
let current = null;

function show(name) {
  current = name;
  for (const key of order) document.getElementById(key).hidden = key !== name;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("aria-current", String(tab.dataset.tab === name));
  }
}

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => show(tab.dataset.tab));
}

// Clicked buttons would otherwise keep focus, and Space would press them again.
document.addEventListener("click", (event) => {
  if (event.target.closest("button")) document.activeElement?.blur();
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
  const index = ["1", "2", "3"].indexOf(event.key);
  if (index >= 0) {
    show(order[index]);
    event.preventDefault();
  } else if (tracks[current].onKey(event.key)) {
    event.preventDefault();
  }
});

show("ai");

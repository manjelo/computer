import {
  GATES, PLACES, STEPS, bitsToNumber, matchesGoal, numberToChar, sumText,
} from "./computer-core.mjs";

const NS = "http://www.w3.org/2000/svg";

function el(parent, tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

const GATE_INFO = {
  and: {
    title: "AND",
    story: "The door opens only if you have the key AND the code.",
    a: "Key", b: "Code", lampOn: "Door opens", lampOff: "Door stays shut",
  },
  or: {
    title: "OR",
    story: "The alarm rings if the front door OR the back door opens.",
    a: "Front", b: "Back", lampOn: "Alarm rings", lampOff: "Alarm silent",
  },
};

export function createComputerTrack() {
  const goalText = document.getElementById("binary-goal");
  const switchRoot = document.getElementById("binary-switches");
  const bitsText = document.getElementById("binary-bits");
  const numberText = document.getElementById("binary-number");
  const sum = document.getElementById("binary-sum");
  const letterText = document.getElementById("binary-letter");
  const letterCard = document.getElementById("binary-letter-card");

  let step = 0;
  let bits = PLACES.map(() => 0);
  let goal = null;

  const switches = PLACES.map((place, index) => {
    const button = document.createElement("button");
    button.className = "bit";
    button.innerHTML = `<span class="bit-place">${place}</span><span class="bit-lamp"></span><span class="bit-value"></span>`;
    button.setAttribute("aria-label", `Switch worth ${place}`);
    button.addEventListener("click", () => {
      bits[index] = bits[index] ? 0 : 1;
      renderBinary();
    });
    switchRoot.append(button);
    return button;
  });

  function renderBinary() {
    switches.forEach((button, index) => {
      button.classList.toggle("on", Boolean(bits[index]));
      button.setAttribute("aria-pressed", String(Boolean(bits[index])));
      button.querySelector(".bit-value").textContent = bits[index];
    });
    const number = bitsToNumber(bits);
    bitsText.textContent = bits.join("");
    numberText.textContent = number;
    sum.textContent = sumText(bits);
    letterText.textContent = numberToChar(number) ?? "–";

    const matched = matchesGoal(bits, goal);
    letterCard.classList.toggle("match", matched);
    goalText.className = matched ? "goal done" : "goal";
    if (goal === null) {
      goalText.textContent = "Every letter is stored as a number, in switches that are on or off";
    } else if (matched) {
      goalText.textContent = `You did it! That's how a computer stores "${goal}"`;
    } else {
      goalText.textContent = `Spell the letter ${goal}. It is number ${goal.charCodeAt(0)}.`;
    }
  }

  function createGate(name) {
    const info = GATE_INFO[name];
    const card = document.getElementById(`gate-${name}`);
    const heading = document.createElement("h2");
    heading.textContent = info.title;
    const story = document.createElement("p");
    story.className = "gate-story";
    story.textContent = info.story;
    card.append(heading, story);

    const svg = el(card, "svg", { class: "gate-svg", viewBox: "0 0 760 330", role: "img", "aria-label": `${info.title} gate` });
    const inputs = { a: false, b: false };

    const wireA = el(svg, "path", { class: "gate-wire", d: "M170 85 H300" });
    const wireB = el(svg, "path", { class: "gate-wire", d: "M170 245 H300" });
    const wireOut = el(svg, "path", { class: "gate-wire", d: "M470 165 H590" });

    if (name === "and") {
      el(svg, "path", { class: "gate-shape", d: "M300 45 H385 A120 120 0 0 1 385 285 H300 Z" });
    } else {
      el(svg, "path", { class: "gate-shape", d: "M280 45 Q360 45 475 165 Q360 285 280 285 Q330 165 280 45 Z" });
    }
    el(svg, "text", { class: "gate-word", x: 380, y: 165 }, info.title);

    const lamp = el(svg, "circle", { class: "gate-lamp", cx: 640, cy: 165, r: 50 });
    const result = el(svg, "text", { class: "gate-result", x: 640, y: 262 });

    function makeInput(key, label, y) {
      const group = el(svg, "g", { class: "gate-input", role: "button", "aria-label": label });
      el(group, "rect", { x: 10, y: y - 45, width: 160, height: 90, rx: 12 });
      el(group, "text", { x: 90, y }, label);
      group.addEventListener("click", () => {
        inputs[key] = !inputs[key];
        render();
      });
      return group;
    }
    const inputA = makeInput("a", info.a, 85);
    const inputB = makeInput("b", info.b, 245);

    function render() {
      const output = GATES[name](inputs.a, inputs.b);
      inputA.classList.toggle("on", inputs.a);
      inputB.classList.toggle("on", inputs.b);
      wireA.classList.toggle("on", inputs.a);
      wireB.classList.toggle("on", inputs.b);
      wireOut.classList.toggle("on", output);
      lamp.classList.toggle("on", output);
      result.textContent = output ? info.lampOn : info.lampOff;
    }
    render();

    return () => {
      inputs.a = inputs.b = false;
      render();
    };
  }

  const resetGates = [createGate("and"), createGate("or")];

  function renderStep() {
    const name = STEPS[step];
    document.getElementById("binary-step").hidden = name !== "binary";
    document.getElementById("gates-step").hidden = name !== "gates";
    document.getElementById("close-step").hidden = name !== "close";
    document.getElementById("computer-note").hidden = name !== "binary";
    for (const pill of document.querySelectorAll(".computer-steps .stage")) {
      pill.classList.toggle("active", pill.dataset.step === name);
    }
  }

  function move(delta) {
    step = Math.max(0, Math.min(STEPS.length - 1, step + delta));
    renderStep();
  }

  function resetAll() {
    bits = PLACES.map(() => 0);
    goal = null;
    resetGates.forEach((reset) => reset());
    renderBinary();
  }

  document.getElementById("computer-next").addEventListener("click", () => move(1));
  document.getElementById("computer-back").addEventListener("click", () => move(-1));
  document.getElementById("computer-reset").addEventListener("click", resetAll);

  renderBinary();
  renderStep();

  return {
    onKey(key) {
      if (key === " " || key === "ArrowRight") move(1);
      else if (key === "ArrowLeft") move(-1);
      else if (key === "0") resetAll();
      else if (STEPS[step] === "binary" && /^[a-zA-Z]$/.test(key)) {
        goal = key.toUpperCase();
        bits = PLACES.map(() => 0);
        renderBinary();
      } else return false;
      return true;
    },
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPS, APP_NAMES, FAULT_NODES, NODES, RUSH_PHASES, SCENARIOS, WIRES, alertOf, back, currentHop,
  describe, fullTrip, hopsFor, initialState, isAtEnd, next, screen, skippedNodes, stepNumber,
  toggleFault, toggleMystery, toggleScenario, totalSteps, withApp,
} from "../../web/dev-core.mjs";
import {
  GATES, RACE_LOCK_MS, RACE_SECONDS, STEPS, bitsToNumber, laptopCounted, matchesGoal, newRace,
  numberToBits, numberToChar, pressSpace, secondsLeft, spaceMovesOn, sumText, timesFaster,
} from "../../web/computer-core.mjs";

const route = (state) => {
  const hops = hopsFor(state);
  return [hops[0].from, ...hops.map((hop) => hop.to)];
};

// Every setup the presenter can reach: each app, with no scenario, each scenario, and each fault.
const setups = APP_NAMES.flatMap((app) => [
  initialState({ app }),
  ...SCENARIOS.map((scenario) => initialState({ app, scenario })),
  ...FAULT_NODES.map((fault) => initialState({ app, fault })),
]);

test("every hop follows the previous one and uses a real wire", () => {
  for (const state of setups.filter((setup) => setup.scenario !== "rush")) {
    hopsFor(state).forEach((hop, index, hops) => {
      assert.ok(NODES[hop.from] && NODES[hop.to]);
      if (index) assert.equal(hop.from, hops[index - 1].to);
      const wired = WIRES.some(([a, b]) => (a === hop.from && b === hop.to) || (a === hop.to && b === hop.from));
      assert.ok(wired, `${hop.from} to ${hop.to} has no wire`);
    });
  }
});

test("a normal trip goes through DNS then the whole server chain, for every app", () => {
  for (const app of APP_NAMES) {
    assert.deepEqual(route(initialState({ app })), [
      "browser", "dns", "browser", "server", "gateway", "service",
      "database", "service", "gateway", "server", "browser",
    ]);
    const end = fullTrip(initialState({ app })).at(-1);
    assert.equal(end.phase, "done");
    assert.equal(screen(end).kind, APPS[app].page);
    assert.equal(next(end), end);
  }
});

test("each app tells its own story", () => {
  const packets = APP_NAMES.map((app) => hopsFor(initialState({ app })).map((hop) => hop.packet).join("|"));
  assert.equal(new Set(packets).size, APP_NAMES.length);
  assert.equal(new Set(APP_NAMES.map((app) => APPS[app].page)).size, APP_NAMES.length);
  assert.ok(hopsFor(initialState({ app: "youtube" }))[1].packet.includes(APPS.youtube.address));
});

test("a second visit skips DNS and the database, so the trip is shorter", () => {
  const again = initialState({ scenario: "again" });
  assert.deepEqual(route(again), ["browser", "server", "gateway", "service", "gateway", "server", "browser"]);
  assert.ok(totalSteps(again) < totalSteps(initialState()));
  const trip = fullTrip(again);
  assert.deepEqual(skippedNodes(trip[0]), []);
  assert.deepEqual(skippedNodes(trip[1]), ["dns"]);
  assert.deepEqual(skippedNodes(trip.at(-1)), ["dns", "database"]);
  assert.match(describe(trip.at(-1)).text, /6 trips instead of 10/);
});

test("a logged-out request is stopped at the gateway and never reaches the data", () => {
  const blocked = initialState({ scenario: "blocked" });
  const stops = route(blocked);
  assert.ok(!stops.includes("service") && !stops.includes("database"));
  const trip = fullTrip(blocked);
  assert.equal(alertOf(trip[4]), null);
  assert.deepEqual(alertOf(trip[5]), { node: "gateway", label: "STOP" });
  assert.equal(screen(trip.at(-1)).kind, "login");
  assert.equal(currentHop(trip[5]).kind, "blocked");
});

test("a fault at any stop leaves the phone waiting there, then reveals that stop", () => {
  for (const app of APP_NAMES) {
    for (const fault of FAULT_NODES) {
      const trip = fullTrip(initialState({ app, fault }));
      const [revealed, stuck, arrived] = trip.slice(-3).reverse();
      assert.equal(currentHop(arrived).to, fault);
      assert.equal(stuck.phase, "stuck");
      assert.equal(alertOf(stuck), null, "the failure stays hidden while students guess");
      assert.equal(screen(stuck).kind, "loading");
      assert.deepEqual(alertOf(revealed), { node: fault, label: "DOWN" });
      assert.equal(screen(revealed).kind, "error");
      assert.ok(isAtEnd(revealed));
      assert.ok(!trip.some((state) => state.phase === "done"));
    }
  }
});

test("the mystery fault picks any of the five stops and switches off on a second press", () => {
  const picked = [0, 0.2, 0.4, 0.6, 0.99].map((value) => toggleMystery(initialState(), () => value).fault);
  assert.deepEqual(picked, FAULT_NODES);
  const mystery = toggleMystery(initialState({ app: "game" }), () => 0.5);
  assert.ok(mystery.mystery && mystery.app === "game");
  assert.deepEqual(toggleMystery(mystery), initialState({ app: "game" }));
});

test("rush hour builds up, overloads the server, then clears", () => {
  const trip = fullTrip(initialState({ scenario: "rush" }));
  assert.deepEqual(trip.map((state) => state.phase), RUSH_PHASES);
  assert.deepEqual(alertOf(trip[2]), { node: "server", label: "BUSY" });
  assert.equal(screen(trip[2]).kind, "loading");
  assert.equal(screen(trip.at(-1)).kind, "feed");
  assert.equal(currentHop(trip[1]), null);
});

test("step numbers count up to the total with no gaps", () => {
  for (const setup of setups) {
    const trip = fullTrip(setup);
    trip.forEach((state, index) => assert.equal(stepNumber(state), index));
    assert.equal(stepNumber(trip.at(-1)), totalSteps(trip[0]));
  }
});

test("back undoes next at every step, for every setup", () => {
  for (const setup of setups) {
    const trip = fullTrip(setup);
    for (let index = trip.length - 1; index > 0; index--) {
      assert.deepEqual(back(trip[index]), trip[index - 1]);
    }
    assert.equal(back(trip[0]), trip[0]);
  }
});

test("scenarios and faults replace each other, and changing app keeps them", () => {
  const moved = next(next(initialState()));
  assert.deepEqual(toggleScenario(moved, "again"), initialState({ scenario: "again" }));
  assert.deepEqual(toggleScenario(initialState({ scenario: "again" }), "again"), initialState());
  assert.deepEqual(toggleFault(initialState({ scenario: "rush" }), "dns"), initialState({ fault: "dns" }));
  assert.deepEqual(toggleFault(initialState({ fault: "dns" }), "dns"), initialState());
  assert.deepEqual(toggleScenario(initialState({ fault: "dns" }), "blocked"), initialState({ scenario: "blocked" }));
  assert.deepEqual(withApp(next(initialState({ scenario: "blocked" })), "youtube"), initialState({ app: "youtube", scenario: "blocked" }));
});

test("every state has a caption", () => {
  for (const setup of setups) {
    for (const state of fullTrip(setup)) {
      const { title, text } = describe(state);
      assert.ok(title && text, JSON.stringify(state));
    }
  }
});

test("binary converts in both directions", () => {
  assert.equal(bitsToNumber([0, 1, 0, 0, 0, 0, 0, 1]), 65);
  assert.deepEqual(numberToBits(65), [0, 1, 0, 0, 0, 0, 0, 1]);
  for (let number = 0; number < 256; number++) {
    assert.equal(bitsToNumber(numberToBits(number)), number);
  }
});

test("only visible characters count as letters", () => {
  assert.equal(numberToChar(65), "A");
  assert.equal(numberToChar(0), null);
  assert.equal(numberToChar(32), null);
  assert.equal(numberToChar(200), null);
});

test("the sum is shown only when more than one switch is on", () => {
  assert.equal(sumText(numberToBits(65)), "64 + 1 = 65");
  assert.equal(sumText(numberToBits(64)), "");
  assert.equal(sumText(numberToBits(0)), "");
});

test("the goal matches only the right letter", () => {
  assert.ok(matchesGoal(numberToBits(77), "M"));
  assert.ok(!matchesGoal(numberToBits(78), "M"));
  assert.ok(!matchesGoal(numberToBits(77), null));
});

test("gates follow their truth tables", () => {
  const table = [[false, false], [false, true], [true, false], [true, true]];
  assert.deepEqual(table.map(([a, b]) => GATES.and(a, b)), [false, false, false, true]);
  assert.deepEqual(table.map(([a, b]) => GATES.or(a, b)), [false, true, true, true]);
});

test("the race comes after the gates and before the closing line", () => {
  assert.deepEqual(STEPS, ["binary", "gates", "race", "close"]);
});

test("the race clock starts at the first press, and late presses don't count", () => {
  let race = pressSpace(newRace(), 1000);
  assert.equal(race.phase, "running");
  assert.equal(race.you, 1);
  assert.equal(secondsLeft(race, 1000), RACE_SECONDS);
  assert.equal(secondsLeft(race, 3500), RACE_SECONDS - 2.5);
  race = pressSpace(race, 1000 + RACE_SECONDS * 1000 - 1);
  assert.equal(race.you, 2);
  race = pressSpace(race, 1000 + RACE_SECONDS * 1000);
  assert.equal(race.you, 2);
  assert.equal(secondsLeft(race, 1000 + RACE_SECONDS * 1000 + 50), 0);
});

test("the race ends only when the laptop says it is done", () => {
  let race = pressSpace(newRace(), 0);
  race = laptopCounted(race, 1_000_000, false, 100);
  assert.equal(race.phase, "running");
  assert.equal(race.laptop, 1_000_000);
  race = laptopCounted(race, 5_000_000_000, true, 5020);
  assert.equal(race.phase, "done");
  assert.equal(race.laptop, 5_000_000_000);
  assert.equal(secondsLeft(race, 5020), 0);
  assert.deepEqual(laptopCounted(race, 1, false, 6000), race, "a finished race keeps its result");
  assert.deepEqual(laptopCounted(newRace(), 1, true, 0), newRace(), "a race that hasn't started ignores the laptop");
});

test("Space shows the result for a moment before moving on", () => {
  const done = laptopCounted(pressSpace(newRace(), 0), 5e9, true, 5000);
  assert.ok(!spaceMovesOn(done, 5000 + RACE_LOCK_MS - 1));
  assert.deepEqual(pressSpace(done, 5000 + 100), done, "a late press leaves the result alone");
  assert.ok(spaceMovesOn(done, 5000 + RACE_LOCK_MS));
  assert.ok(!spaceMovesOn(newRace(), 1e9));
  assert.ok(!spaceMovesOn(pressSpace(newRace(), 0), 1e9));
});

test("how much faster the laptop was reads naturally", () => {
  assert.equal(timesFaster(40, 5e9), "125 million");
  assert.equal(timesFaster(50, 4.8e9), "96 million");
  assert.equal(timesFaster(700, 4.8e9), "6.9 million");
  assert.equal(timesFaster(3, 5e9), "1.7 billion");
  assert.equal(timesFaster(1, 5e9), "5 billion");
  assert.equal(timesFaster(10, 25_000), "2,500");
});

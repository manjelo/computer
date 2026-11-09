// The story of one request, with no drawing code, so it can be tested on its own.

export const NODES = {
  browser: { title: "Your phone", sub: "Browser" },
  dns: { title: "DNS", sub: "Internet phone book" },
  server: { title: "Server", sub: "Receives the request" },
  gateway: { title: "API gateway", sub: "Checks and directs" },
  service: { title: "Service", sub: "Does the work" },
  database: { title: "Database", sub: "Remembers everything" },
};

export const WIRES = [
  ["browser", "dns"],
  ["browser", "server"],
  ["server", "gateway"],
  ["gateway", "service"],
  ["service", "database"],
];

// Addresses come from a block reserved for examples, so none of them is a real server.
export const APPS = {
  instagram: {
    name: "Instagram", bar: "instagram.com", address: "203.0.113.7", page: "feed",
    find: "Where is instagram.com?", ask: "Open my feed", work: "Build this feed",
    dbAsk: "Newest posts?", dbReply: "Here are 12 posts", data: "posts",
    dbText: "The posts are stored here, ready to be found.",
    dbDown: "The database was down, so there were no posts to send",
    result: "Your feed", thing: "feed",
    show: "Your phone turns the answer into a page.", done: "The page appears",
  },
  youtube: {
    name: "YouTube", bar: "youtube.com", address: "203.0.113.24", page: "video",
    find: "Where is youtube.com?", ask: "Play this video", work: "Find this video",
    dbAsk: "Where is the video?", dbReply: "Here's the video", data: "video",
    dbText: "Millions of videos are stored here, ready to be found.",
    dbDown: "The database was down, so the video couldn't be found",
    result: "Your video", thing: "video",
    show: "Your phone starts playing it.", done: "The video plays",
  },
  game: {
    name: "an online game", bar: "Online game", address: "203.0.113.50", page: "match",
    find: "Where is the game server?", ask: "Find me a match", work: "Find 9 players",
    dbAsk: "Players at my level?", dbReply: "Here are 9 players", data: "players",
    dbText: "Every player's level is stored here.",
    dbDown: "The database was down, so no players could be found",
    result: "Match found!", thing: "match",
    show: "Your game puts you in the match.", done: "The match starts",
  },
};

export const APP_NAMES = Object.keys(APPS);

const FAULT_INFO = {
  dns: { reveal: () => "DNS was down, so your phone never got the address", error: "Site not found" },
  server: { reveal: () => "The server was down, so nobody answered at that address", error: "Can't connect" },
  gateway: { reveal: () => "The API gateway was down, so the request couldn't get in", error: "Something went wrong" },
  service: { reveal: (app) => `The service crashed, so nobody could prepare your ${app.thing}`, error: "Something went wrong" },
  database: { reveal: (app) => app.dbDown, error: "Something went wrong" },
};

export const FAULT_NODES = Object.keys(FAULT_INFO);
export const SCENARIOS = ["again", "blocked", "rush"];
export const RUSH_PHASES = ["ready", "surge", "overloaded", "scaled", "done"];

function hop(from, to, kind, packet, title, text) {
  return { from, to, kind, packet, title, text };
}

function normalHops(app) {
  return [
    hop("browser", "dns", "request", app.find, "Your phone asks DNS for the address", "Computers find each other by number, not by name."),
    hop("dns", "browser", "reply", `It's at ${app.address}`, "DNS answers with the address", "Now your phone knows where to go."),
    hop("browser", "server", "request", app.ask, "Your phone sends the request to the server", "The request travels across the internet to that address."),
    hop("server", "gateway", "request", app.ask, "The server passes it to the API gateway", "The gateway checks who is asking and picks who should handle it."),
    hop("gateway", "service", "request", app.work, "The gateway calls the right service", "Big apps are made of many small services, each with one job."),
    hop("service", "database", "request", app.dbAsk, "The service asks the database", app.dbText),
    hop("database", "service", "reply", app.dbReply, `The database sends the ${app.data} back`, "The data starts its trip home."),
    hop("service", "gateway", "reply", app.result, `The service returns the finished ${app.thing}`, "The answer goes back the way it came."),
    hop("gateway", "server", "reply", app.result, "The gateway hands it to the server", "Almost there."),
    hop("server", "browser", "reply", app.result, "The server answers your phone", app.show),
  ];
}

// A minute later: the phone remembers the address, and the service remembers the answer.
function againHops(app) {
  const [, , toServer, toGateway, toService, , , , toServerBack, toPhone] = normalHops(app);
  return [
    { ...toServer, title: "Your phone already knows the address", text: "It remembered DNS's answer from last time, so it skips that stop." },
    toGateway,
    toService,
    hop("service", "gateway", "reply", app.result, "The service remembered the answer", "It kept a copy from last time, so it doesn't ask the database again."),
    toServerBack,
    toPhone,
  ];
}

function blockedHops(app) {
  const [toDns, fromDns, toServer, toGateway] = normalHops(app);
  return [
    toDns,
    fromDns,
    { ...toServer, packet: `${app.ask} (logged out)` },
    { ...toGateway, packet: `${app.ask} (logged out)`, text: "The gateway checks who is asking. This request has no login." },
    hop("gateway", "server", "blocked", "Not allowed: log in first", "The API gateway says no", "Without a login, the request never reaches the service or anyone's data."),
    hop("server", "browser", "blocked", "Please log in", "The server tells your phone", "Your phone shows the login screen instead."),
  ];
}

export function hopsFor(state) {
  const app = APPS[state.app];
  if (state.scenario === "again") return againHops(app);
  if (state.scenario === "blocked") return blockedHops(app);
  if (state.scenario === "rush") return [];
  return normalHops(app);
}

// phase: "ready" -> "hop" (index = completed hop) -> "done"
// With a fault: "hop" -> "stuck" (no answer, students guess) -> "revealed" (the stop turns red).
// Rush hour has no hops: "ready" -> "surge" -> "overloaded" -> "scaled" -> "done".
export function initialState({ app = "instagram", scenario = null, fault = null, mystery = false } = {}) {
  return { app, scenario, fault, mystery, phase: "ready", hop: -1 };
}

export function restart(state) {
  return initialState(state);
}

function faultHop(state) {
  return state.fault ? hopsFor(state).findIndex((step) => step.to === state.fault) : -1;
}

export function next(state) {
  if (state.scenario === "rush") {
    const index = RUSH_PHASES.indexOf(state.phase);
    return index < RUSH_PHASES.length - 1 ? { ...state, phase: RUSH_PHASES[index + 1] } : state;
  }
  switch (state.phase) {
    case "ready":
      return { ...state, phase: "hop", hop: 0 };
    case "hop":
      if (state.hop === faultHop(state)) return { ...state, phase: "stuck" };
      if (state.hop === hopsFor(state).length - 1) return { ...state, phase: "done" };
      return { ...state, hop: state.hop + 1 };
    case "stuck":
      return { ...state, phase: "revealed" };
    default:
      return state;
  }
}

export function back(state) {
  if (state.scenario === "rush") {
    const index = RUSH_PHASES.indexOf(state.phase);
    return index > 0 ? { ...state, phase: RUSH_PHASES[index - 1] } : state;
  }
  switch (state.phase) {
    case "hop":
      return state.hop === 0 ? restart(state) : { ...state, hop: state.hop - 1 };
    case "stuck":
    case "done":
      return { ...state, phase: "hop" };
    case "revealed":
      return { ...state, phase: "stuck" };
    default:
      return state;
  }
}

// Changing the app keeps the scenario. Each scenario or fault replaces any other one.
export function withApp(state, app) {
  return initialState({ ...state, app });
}

export function toggleScenario(state, scenario) {
  return initialState({ app: state.app, scenario: state.scenario === scenario ? null : scenario });
}

export function toggleFault(state, fault) {
  const same = state.fault === fault && !state.mystery;
  return initialState({ app: state.app, fault: same ? null : fault });
}

export function toggleMystery(state, random = Math.random) {
  if (state.mystery) return initialState({ app: state.app });
  const fault = FAULT_NODES[Math.min(FAULT_NODES.length - 1, Math.floor(random() * FAULT_NODES.length))];
  return initialState({ app: state.app, fault, mystery: true });
}

export function isAtEnd(state) {
  return state.phase === "done" || state.phase === "revealed";
}

export function totalSteps(state) {
  if (state.scenario === "rush") return RUSH_PHASES.length - 1;
  const stop = faultHop(state);
  return stop >= 0 ? stop + 3 : hopsFor(state).length + 1;
}

export function stepNumber(state) {
  if (state.scenario === "rush") return RUSH_PHASES.indexOf(state.phase);
  if (state.phase === "ready") return 0;
  if (state.phase === "hop") return state.hop + 1;
  if (state.phase === "stuck") return state.hop + 2;
  return totalSteps(state);
}

export function currentHop(state) {
  if (state.scenario === "rush" || state.phase === "ready") return null;
  return hopsFor(state)[state.hop];
}

const RUSH_TEXT = {
  ready: (app) => ({ tone: "", title: `It's 8 pm and everyone opens ${app.name} at once`, text: "Thousands of phones send the same request in the same second." }),
  surge: () => ({ tone: "", title: "Thousands of requests arrive together", text: "One server can only answer so many at a time." }),
  overloaded: () => ({ tone: "bad", title: "The server can't keep up", text: "Requests wait in line and every phone keeps loading. How would you fix it?" }),
  scaled: () => ({ tone: "", title: "Engineers add more servers", text: "The work is shared between them, so the line clears." }),
  done: () => ({ tone: "good", title: "Everyone gets an answer", text: "Big apps run on thousands of servers so rush hour still feels instant." }),
};

function readyText(state, app) {
  if (state.scenario === "again") return { title: `You open ${app.name} again, a minute later`, text: "Watch which stops it can skip this time." };
  if (state.scenario === "blocked") return { title: `You open ${app.name}, but you're logged out`, text: "Watch who stops the request." };
  return { title: `You open ${app.name} on your phone`, text: "It looks instant. Let's slow it down and follow what really happens." };
}

function doneText(state, app) {
  if (state.scenario === "blocked") return { title: "Your phone asks you to log in", text: "Checking who is asking keeps everyone's accounts safe." };
  if (state.scenario === "again") {
    return {
      title: app.done,
      text: `${hopsFor(state).length} trips instead of 10, so it's faster. Remembering answers like this is called caching.`,
    };
  }
  return { title: app.done, text: "All of that usually takes less than a second." };
}

export function describe(state) {
  const app = APPS[state.app];
  if (state.scenario === "rush") return RUSH_TEXT[state.phase](app);
  switch (state.phase) {
    case "ready":
      return { tone: "", ...readyText(state, app) };
    case "hop": {
      const step = hopsFor(state)[state.hop];
      return { tone: step.kind === "blocked" ? "bad" : "", title: step.title, text: step.text };
    }
    case "stuck":
      return { tone: "bad", title: "No answer came back", text: "Your phone is left waiting. Which stop do you think failed?" };
    case "revealed":
      return { tone: "bad", title: FAULT_INFO[state.fault].reveal(app), text: "Engineers find failures like this by following the path, one stop at a time." };
    default:
      return { tone: "good", ...doneText(state, app) };
  }
}

// What the phone's screen shows.
export function screen(state) {
  if (state.phase === "ready") return { kind: "blank" };
  if (state.phase === "done") return { kind: state.scenario === "blocked" ? "login" : APPS[state.app].page };
  if (state.phase === "revealed") return { kind: "error", message: FAULT_INFO[state.fault].error };
  return { kind: "loading" };
}

// The stop to mark in red, and the word on its badge.
export function alertOf(state) {
  if (state.phase === "revealed") return { node: state.fault, label: "DOWN" };
  if (state.scenario === "rush" && state.phase === "overloaded") return { node: "server", label: "BUSY" };
  if (state.scenario === "blocked" && (state.phase === "done" || state.hop >= 4)) return { node: "gateway", label: "STOP" };
  return null;
}

// Stops a second visit skips, faded once the trip has gone past them.
export function skippedNodes(state) {
  if (state.scenario !== "again" || state.phase === "ready") return [];
  return state.phase === "done" || state.hop >= 3 ? ["dns", "database"] : ["dns"];
}

// Every state from the start to the end of the story, used for the real-speed replay.
export function fullTrip(state) {
  const states = [restart(state)];
  while (!isAtEnd(states[states.length - 1])) {
    states.push(next(states[states.length - 1]));
  }
  return states;
}

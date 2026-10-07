// GrantKosh — tiny, dependency-free directory UI.
// Edit REPO below after you publish the repo so the "suggest" links work.
const REPO = "your-username/grantkosh";

const LABELS = {
  type: { grant: "Grant", challenge: "Challenge", loan: "Loan / guarantee", subsidy: "Subsidy", fellowship: "Fellowship", accelerator: "Accelerator", international: "International" },
  stage: { idea: "Idea", prototype: "Prototype", "early-revenue": "Early revenue", growth: "Growth" },
  founder: { any: "Anyone", women: "Women founders", "sc-st": "SC/ST founders", student: "Students", researcher: "Researchers" },
};
const QUICK = [
  { id: "equity-free", label: "Equity-free", test: g => g.equityFree },
  { id: "no-dpiit", label: "No DPIIT needed", test: g => !g.requiresDPIIT },
  { id: "big", label: "₹25L+", test: g => g.fundingMax >= 2500000 },
  { id: "women", label: "Women founders", test: g => g.founderTypes.includes("women") },
  { id: "students", label: "Students", test: g => g.founderTypes.includes("student") },
  { id: "defence", label: "Defence & drones", test: g => g.sectors.some(s => ["defence", "drones"].includes(s)) },
  { id: "pan-india", label: "Pan-India", test: g => g.states.includes("pan-india") },
  { id: "verified", label: "Verified only", test: g => g.verified },
];

const $ = s => document.querySelector(s);
const state = { q: "", sort: "amount-desc", quick: new Set(), type: "", stage: "", sector: "", state: "", founder: "", min: 0 };
let GRANTS = [];

const titleCase = s => s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const label = (group, v) => (LABELS[group] && LABELS[group][v]) || titleCase(v);

function inr(n) {
  if (!n) return "Varies";
  if (n >= 1e7) return "₹" + +(n / 1e7).toFixed(2) + "Cr";
  if (n >= 1e5) return "₹" + +(n / 1e5).toFixed(2) + "L";
  return "₹" + n.toLocaleString("en-IN");
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- URL state (shareable filtered views) ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of ["q", "sort", "type", "stage", "sector", "state", "founder"]) if (p.get(k)) state[k] = p.get(k);
  if (p.get("min")) state.min = +p.get("min");
  if (p.get("quick")) p.get("quick").split(",").forEach(x => state.quick.add(x));
  return p.get("open");
}
function writeHash(open) {
  const p = new URLSearchParams();
  for (const k of ["q", "type", "stage", "sector", "state", "founder"]) if (state[k]) p.set(k, state[k]);
  if (state.sort !== "amount-desc") p.set("sort", state.sort);
  if (state.min) p.set("min", state.min);
  if (state.quick.size) p.set("quick", [...state.quick].join(","));
  if (open) p.set("open", open);
  history.replaceState(null, "", p.toString() ? "#" + p : location.pathname);
}

// ---------- filtering ----------
function matches(g) {
  if (state.q) {
    const hay = [g.name, g.provider, g.summary, g.fundingNote, ...g.sectors, ...g.states, g.type].join(" ").toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  for (const id of state.quick) { const qf = QUICK.find(x => x.id === id); if (qf && !qf.test(g)) return false; }
  if (state.type && g.type !== state.type) return false;
  if (state.stage && !g.stages.includes(state.stage)) return false;
  if (state.sector && !g.sectors.includes(state.sector) && !g.sectors.includes("any")) return false;
  if (state.state && !g.states.includes(state.state) && !(state.state !== "international" && g.states.includes("pan-india"))) return false;
  if (state.founder && !g.founderTypes.includes(state.founder) && !g.founderTypes.includes("any")) return false;
  if (state.min && g.fundingMax < state.min) return false;
  return true;
}
const sorters = {
  "amount-desc": (a, b) => b.fundingMax - a.fundingMax,
  "amount-asc": (a, b) => a.fundingMax - b.fundingMax,
  name: (a, b) => a.name.localeCompare(b.name),
  verified: (a, b) => (b.lastVerified || "").localeCompare(a.lastVerified || ""),
};

// ---------- rendering ----------
function tags(g) {
  const t = [`<span class="tag tag-type">${esc(label("type", g.type))}</span>`];
  if (g.equityFree) t.push(`<span class="tag">Equity-free</span>`);
  if (g.requiresDPIIT) t.push(`<span class="tag">DPIIT required</span>`);
  g.stages.forEach(s => t.push(`<span class="tag">${esc(label("stage", s))}</span>`));
  if (!g.states.includes("pan-india")) g.states.forEach(s => t.push(`<span class="tag">${esc(titleCase(s))}</span>`));
  t.push(g.verified ? `<span class="tag tag-ok">Verified ${esc(g.lastVerified)}</span>` : `<span class="tag tag-warn">Needs check</span>`);
  return t.join("");
}

function render() {
  const list = GRANTS.filter(matches).sort(sorters[state.sort]);
  $("#result-meta").textContent = `${list.length} of ${GRANTS.length} programs`;
  $("#list").innerHTML = list.length ? list.map(g => `
    <li class="entry" data-id="${esc(g.id)}" tabindex="0">
      <div>
        <h3>${esc(g.name)}</h3>
        <p class="by">${esc(g.provider)}</p>
        <p class="summary">${esc(g.summary)}</p>
      </div>
      <div class="amount"><small>up to</small><b>${inr(g.fundingMax)}</b><small>${esc(g.cadence)}</small></div>
      <div class="tags">${tags(g)}</div>
    </li>`).join("") : `<li class="empty">Nothing matches. Try clearing a filter — or <a href="${suggestUrl()}" target="_blank" rel="noopener">add a program you know about</a>.</li>`;

  const active = [state.type, state.stage, state.sector, state.state, state.founder, state.min].filter(Boolean).length;
  $("#active-count").textContent = active ? `(${active} active)` : "";
  document.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", state.quick.has(c.dataset.id)));
  writeHash();
}

function openDetail(id) {
  const g = GRANTS.find(x => x.id === id);
  if (!g) return;
  $("#detail-body").innerHTML = `
    <h2>${esc(g.name)}</h2>
    <p class="by">${esc(g.provider)}</p>
    <div class="tags">${tags(g)}</div>
    <h4>Funding</h4><p>${esc(g.fundingNote)}</p>
    <h4>Who it's for</h4><p>${esc(g.summary)}</p>
    <h4>Eligibility (summary)</h4><ul>${g.eligibility.map(e => `<li>${esc(e)}</li>`).join("")}</ul>
    <h4>When to apply</h4><p>${esc(g.cadence)}${g.deadline ? ` — closes <b>${esc(g.deadline)}</b>` : ""}</p>
    <h4>Sectors</h4><p>${g.sectors.map(s => esc(titleCase(s))).join(", ")}</p>
    <a class="cta" href="${esc(g.url)}" target="_blank" rel="noopener">Official page ↗</a>
    <p class="fine">Something wrong or outdated? <a href="${suggestUrl(g)}" target="_blank" rel="noopener">Report it on GitHub</a>.</p>`;
  $("#detail").showModal();
  writeHash(id);
}

function suggestUrl(g) {
  const title = g ? `Correction: ${g.name}` : "New program: ";
  const body = g ? `Program id: \`${g.id}\`\n\nWhat's wrong / what changed:\n\nOfficial source link:\n` : "Name:\nProvider:\nOfficial link:\nAmount:\nWho can apply:\n";
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

// ---------- setup ----------
function fillSelect(sel, values, group) {
  [...new Set(values)].sort().forEach(v => {
    const o = document.createElement("option"); o.value = v; o.textContent = label(group, v); sel.appendChild(o);
  });
}

function stats() {
  const n = GRANTS.length, eq = GRANTS.filter(g => g.equityFree).length, ver = GRANTS.filter(g => g.verified).length;
  $("#stats").innerHTML = `
    <div class="stat"><b>${n}</b><span>programs listed</span></div>
    <div class="stat"><b>${eq}</b><span>equity-free</span></div>
    <div class="stat"><b>${ver}</b><span>verified against source</span></div>`;
}

function initTheme() {
  try { const t = localStorage.getItem("gk-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("gk-theme", next); } catch {}
  });
}

async function init() {
  initTheme();
  $("#repo-link").href = `https://github.com/${REPO}`;
  $("#suggest-link").href = suggestUrl();

  try {
    GRANTS = window.GRANTKOSH_DATA || await (await fetch("data/grants.json")).json();
  } catch (e) {
    $("#list").innerHTML = `<li class="empty">Couldn't load data/grants.json. If you opened index.html directly from disk, run <code>npx serve .</code> instead.</li>`;
    return;
  }

  const open = readHash();
  $("#quick-chips").innerHTML = QUICK.map(q => `<button class="chip" data-id="${q.id}" aria-pressed="false">${q.label}</button>`).join("");
  fillSelect($("#f-type"), GRANTS.map(g => g.type), "type");
  fillSelect($("#f-stage"), GRANTS.flatMap(g => g.stages), "stage");
  fillSelect($("#f-sector"), GRANTS.flatMap(g => g.sectors).filter(s => s !== "any"), "sector");
  fillSelect($("#f-state"), GRANTS.flatMap(g => g.states), "state");
  fillSelect($("#f-founder"), GRANTS.flatMap(g => g.founderTypes).filter(s => s !== "any"), "founder");

  const bind = (sel, key, num) => { const el = $(sel); el.value = state[key]; el.addEventListener("input", () => { state[key] = num ? +el.value : el.value; render(); }); };
  bind("#q", "q"); bind("#sort", "sort");
  bind("#f-type", "type"); bind("#f-stage", "stage"); bind("#f-sector", "sector");
  bind("#f-state", "state"); bind("#f-founder", "founder"); bind("#f-min", "min", true);

  $("#quick-chips").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    state.quick.has(c.dataset.id) ? state.quick.delete(c.dataset.id) : state.quick.add(c.dataset.id);
    render();
  });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { q: "", type: "", stage: "", sector: "", state: "", founder: "", min: 0 }); state.quick.clear();
    ["#q", "#f-type", "#f-stage", "#f-sector", "#f-state", "#f-founder"].forEach(s => $(s).value = ""); $("#f-min").value = "0";
    render();
  });
  $("#list").addEventListener("click", e => { const li = e.target.closest(".entry"); if (li) openDetail(li.dataset.id); });
  $("#list").addEventListener("keydown", e => { if (e.key === "Enter") { const li = e.target.closest(".entry"); if (li) openDetail(li.dataset.id); } });
  $("#detail").addEventListener("close", () => writeHash());

  stats(); render();
  if (open) openDetail(open);
}
init();

/**
 * Monthly Recap — HTML renderer (server-generated, responsive, animated).
 *
 * Vanilla CSS + JS only (no framework). Mobile-first + desktop friendly.
 * Story-style scroll-snap sections, count-up numbers, IntersectionObserver
 * reveals, confetti, crowns, avatars, share buttons. Respects reduced motion.
 *
 * Renders only aggregate stats (no conversation content).
 */

export interface LeaderboardRow {
  rank: number;
  discordUserId: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  value: number;
}

export interface RecapHtmlData {
  apiKeyName: string;
  displayName: string;
  avatarUrl: string | null;
  monthLabel: string;
  yearMonth: string;
  stats: any;
  narrative: any;
  resolvedAssets: Record<string, { url: string; type: string } | null>;
  leaderboard: { byRequests: LeaderboardRow[]; byTokens: LeaderboardRow[] };
  rank: { requests: number; tokens: number };
  base: string;
  pageUrl: string;
  viewerDiscordUserId: string | null;
}

export function escapeHtml(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n: number): string {
  n = Number(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}

function safeJsonForScript(obj: any): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const RECAP_CSS = `
:root{color-scheme:dark;--bg:#0b0b14;--fg:#fff;--muted:rgba(255,255,255,.7);
--g1:#7c3aed;--g2:#ec4899;--g3:#f59e0b;--g4:#22d3ee;--card:rgba(255,255,255,.07);--line:rgba(255,255,255,.14)}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
overflow-x:hidden}
.deck{height:100dvh;overflow-y:scroll;scroll-snap-type:y mandatory;scroll-behavior:smooth}
.slide{min-height:100dvh;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;
justify-content:center;text-align:center;padding:max(24px,6vw) 20px;position:relative;gap:clamp(12px,3vw,22px)}
.slide::before{content:"";position:absolute;inset:0;z-index:-1;opacity:.5;
background:radial-gradient(900px 600px at 50% 0%,rgba(124,58,237,.35),transparent 60%),
radial-gradient(700px 500px at 100% 100%,rgba(236,72,153,.25),transparent 55%)}
.wrap{width:100%;max-width:760px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:inherit}
.kicker{font-size:clamp(12px,3.2vw,15px);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);font-weight:700}
.big{font-size:clamp(40px,16vw,120px);font-weight:900;line-height:.95;
background:linear-gradient(120deg,var(--g4),var(--g1),var(--g2),var(--g3));-webkit-background-clip:text;
background-clip:text;color:transparent;background-size:200% 200%;animation:flow 8s ease infinite}
@keyframes flow{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.headline{font-size:clamp(26px,8vw,56px);font-weight:900;line-height:1.05}
.caption{font-size:clamp(15px,4.4vw,22px);color:var(--muted);line-height:1.5;max-width:34ch}
.card{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:clamp(18px,5vw,34px);
backdrop-filter:blur(14px);width:100%;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.avatar{width:clamp(96px,28vw,160px);height:clamp(96px,28vw,160px);border-radius:50%;object-fit:cover;
border:4px solid rgba(255,255,255,.25);box-shadow:0 12px 40px rgba(124,58,237,.5)}
.media{max-width:min(80%,360px);max-height:38dvh;border-radius:18px;object-fit:contain;
border:1px solid var(--line);box-shadow:0 12px 40px rgba(0,0,0,.4)}
.reveal{opacity:0;transform:translateY(34px) scale(.96);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
.pop{opacity:0;transform:scale(.5)}
.pop.in{opacity:1;transform:scale(1);transition:opacity .6s,transform .6s cubic-bezier(.2,1.4,.4,1)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%}
@media(max-width:520px){.row2{grid-template-columns:1fr}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.stat .num{font-size:clamp(26px,7vw,40px);font-weight:900}
.stat .lbl{font-size:clamp(12px,3.4vw,14px);color:var(--muted);margin-top:4px}
.bars{width:100%;display:flex;flex-direction:column;gap:14px;margin-top:8px}
.bar{height:26px;border-radius:14px;background:rgba(255,255,255,.1);overflow:hidden;position:relative}
.bar>span{display:block;height:100%;width:0;border-radius:14px;transition:width 1.2s cubic-bezier(.2,.7,.2,1)}
.bar.in>span{width:var(--w)}
.bar .b-in{background:linear-gradient(90deg,var(--g4),var(--g1))}
.bar .b-out{background:linear-gradient(90deg,var(--g2),var(--g3))}
.barlbl{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:4px}
.chip{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);
border-radius:999px;padding:10px 18px;font-weight:700;font-size:clamp(14px,4vw,18px)}
.lb{width:100%;display:flex;flex-direction:column;gap:10px}
.lb-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:6px}
.lb-tab{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:999px;
padding:9px 18px;font-weight:700;cursor:pointer;font-size:14px}
.lb-tab.active{background:linear-gradient(120deg,var(--g1),var(--g2));border-color:transparent}
.lb-item{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);
border-radius:16px;padding:10px 14px;text-align:left}
.lb-item.me{border-color:var(--g3);box-shadow:0 0 0 2px rgba(245,158,11,.4)}
.lb-rank{font-weight:900;font-size:18px;width:30px;text-align:center;flex:0 0 auto}
.lb-av{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--line);flex:0 0 auto}
.lb-name{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.lb-val{font-weight:800;color:var(--g3);font-size:15px}
.crown{width:24px;height:24px;flex:0 0 auto}
.btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.btn{appearance:none;border:none;cursor:pointer;border-radius:999px;padding:14px 24px;font-weight:800;
font-size:clamp(14px,4vw,17px);color:#fff;background:linear-gradient(120deg,var(--g1),var(--g2));
text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:transform .15s}
.btn:active{transform:scale(.95)}
.btn.ghost{background:var(--card);border:1px solid var(--line)}
.hint{position:fixed;left:0;right:0;bottom:14px;text-align:center;color:var(--muted);font-size:13px;
pointer-events:none;animation:bob 1.6s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0);opacity:.6}50%{transform:translateY(6px);opacity:1}}
.toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(80px);
background:#fff;color:#111;padding:12px 22px;border-radius:999px;font-weight:700;opacity:0;
transition:transform .3s,opacity .3s;z-index:50}
.toast.show{transform:translateX(-50%) translateY(0);opacity:1}
.delta-up{color:#34d399}.delta-down{color:#f87171}
.confetti{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.confetti i{position:absolute;top:-20px;width:10px;height:14px;opacity:.9;animation:fall linear forwards}
@keyframes fall{to{transform:translateY(110dvh) rotate(720deg)}}
@media(prefers-reduced-motion:reduce){
.reveal,.pop{transition:none !important;opacity:1 !important;transform:none !important}
.big{animation:none}.confetti{display:none}.hint{animation:none}
.bar>span{transition:none}}
`;

function crownSvg(rank: number): string {
  const colors: Record<number, string> = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32" };
  const color = colors[rank];
  if (!color) return "";
  return `<svg class="crown" viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><path d="M3 7l4 4 5-7 5 7 4-4-2 12H5L3 7z"/></svg>`;
}

function mediaTag(asset: { url: string; type: string } | null | undefined, base: string): string {
  if (!asset || !asset.url) return "";
  const fallback = `${base}/recap-assets/misc/default.svg`;
  if (asset.type === "video") {
    return `<video class="media reveal" autoplay muted loop playsinline preload="metadata"
      onerror="this.style.display='none'"><source src="${escapeHtml(asset.url)}"></video>`;
  }
  return `<img class="media reveal" loading="lazy" alt="" src="${escapeHtml(asset.url)}"
    onerror="this.onerror=null;this.src='${escapeHtml(fallback)}';this.style.display='none'">`;
}

function renderLeaderboardList(rows: LeaderboardRow[], viewerId: string | null, unit: string): string {
  if (!rows.length) return `<div class="caption">Belum ada data peringkat.</div>`;
  return rows.map((r) => {
    const me = viewerId && r.discordUserId === viewerId ? " me" : "";
    const av = r.avatarUrl
      ? `<img class="lb-av" loading="lazy" alt="" src="${escapeHtml(r.avatarUrl)}" onerror="this.style.visibility='hidden'">`
      : `<div class="lb-av" style="display:grid;place-items:center;background:rgba(255,255,255,.1)">${escapeHtml((r.discordUsername || "?").slice(0, 1).toUpperCase())}</div>`;
    return `<div class="lb-item${me}">
      <span class="lb-rank">${crownSvg(r.rank) || "#" + r.rank}</span>
      ${av}
      <span class="lb-name">${escapeHtml(r.discordUsername || "Anonim")}</span>
      <span class="lb-val">${fmtNum(r.value)} ${escapeHtml(unit)}</span>
    </div>`;
  }).join("");
}

function section(id: string, inner: string): string {
  return `<section class="slide" data-slide="${id}"><div class="wrap">${inner}</div></section>`;
}

function n(stats: any, path: string, def = 0): number {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), stats) ?? def;
  } catch { return def; }
}

function buildSections(d: RecapHtmlData): string {
  const s = d.stats || {};
  const nv = d.narrative || {};
  const sec = (nv.sections || {}) as Record<string, { headline?: string; caption?: string }>;
  const A = d.resolvedAssets || {};
  const txt = (k: string, hl: string, cap: string) => ({
    headline: escapeHtml(sec[k]?.headline || hl),
    caption: escapeHtml(sec[k]?.caption || cap),
  });

  const inputTok = n(s, "totals.inputTokens");
  const outputTok = n(s, "totals.outputTokens");
  const maxTok = Math.max(inputTok, outputTok, 1);
  const inPct = Math.round((inputTok / maxTok) * 100);
  const outPct = Math.round((outputTok / maxTok) * 100);

  const out: string[] = [];

  // 1. Intro
  const introT = txt("intro", `Recap ${d.monthLabel}`, "Yuk lihat perjalanan ngoding kamu!");
  out.push(section("intro", `
    ${d.avatarUrl ? `<img class="avatar pop" src="${escapeHtml(d.avatarUrl)}" alt="" onerror="this.style.display='none'">` : ""}
    <div class="kicker reveal">Monthly Recap</div>
    <div class="big reveal">${escapeHtml(d.monthLabel)}</div>
    <div class="headline reveal">${escapeHtml(d.displayName)}</div>
    <div class="caption reveal">${introT.caption}</div>
    ${mediaTag(A.intro, d.base)}
    <div class="hint">Scroll / geser ke bawah ⌄</div>`));

  // 2. Requests
  const reqT = txt("requests", `${fmtNum(n(s, "totals.requests"))} request`, "Total kamu mecut AI bulan ini.");
  out.push(section("requests", `
    <div class="kicker reveal">Total Request</div>
    <div class="big reveal" data-count="${n(s, "totals.requests")}">0</div>
    <div class="caption reveal">${reqT.caption}</div>
    ${mediaTag(A.requests, d.base)}`));

  // 3. Tokens (input vs output)
  const tokT = txt("tokens", `${fmtNum(n(s, "totals.totalTokens"))} token`, "Seberapa banyak kamu ngobrol sama AI.");
  out.push(section("tokens", `
    <div class="kicker reveal">Token Kamu</div>
    <div class="headline reveal">${tokT.headline}</div>
    <div class="card reveal">
      <div class="bars">
        <div><div class="barlbl"><span>📥 Input</span><span>${fmtNum(inputTok)}</span></div>
          <div class="bar" style="--w:${inPct}%"><span class="b-in"></span></div></div>
        <div><div class="barlbl"><span>📤 Output</span><span>${fmtNum(outputTok)}</span></div>
          <div class="bar" style="--w:${outPct}%"><span class="b-out"></span></div></div>
      </div>
    </div>
    <div class="caption reveal">${tokT.caption}</div>
    ${mediaTag(A.tokens, d.base)}`));

  // 4. Favorite model
  const favT = txt("favoriteModel", escapeHtml(n2(s, "models.favorite") || "-"), "Model andalan kamu.");
  out.push(section("favoriteModel", `
    <div class="kicker reveal">Model Favorit</div>
    <div class="headline reveal">${favT.headline}</div>
    <div class="chip reveal">⭐ ${escapeHtml(n2(s, "models.favorite") || "-")}</div>
    <div class="caption reveal">${favT.caption}</div>
    ${mediaTag(A.favoriteModel, d.base)}`));

  // 5. Least used model (only if exists)
  const least = (s.models?.leastUsed || [])[0];
  if (least) {
    const leastT = txt("leastModel", escapeHtml(least.model), "Model yang jarang kamu sentuh. Kita kan teman? 🥲");
    out.push(section("leastModel", `
      <div class="kicker reveal">Yang Terlupakan</div>
      <div class="headline reveal">${leastT.headline}</div>
      <div class="caption reveal">${leastT.caption}</div>
      ${mediaTag(A.leastModel, d.base)}`));
  }

  // 6. Active time
  const hr = n(s, "activity.mostActiveHour.hour", -1);
  const actT = txt("activeTime", hr >= 0 ? `${hr}:00 WIB` : "-", "Waktu paling produktif kamu.");
  out.push(section("activeTime", `
    <div class="kicker reveal">Jam Sibuk</div>
    <div class="big reveal">${hr >= 0 ? hr + ":00" : "-"}</div>
    <div class="caption reveal">${actT.caption}</div>
    ${s.activity?.favoriteWeekday ? `<div class="chip reveal">📅 Paling rajin hari ${escapeHtml(s.activity.favoriteWeekday)}</div>` : ""}
    ${mediaTag(A.activeTime, d.base)}`));

  // 7. Persona
  const personaTitle = nv.persona?.title || "Coder";
  const personaSub = nv.persona?.subtitle || "";
  out.push(section("persona", `
    <div class="kicker reveal">Tipe Kamu</div>
    <div class="big reveal">${escapeHtml(personaTitle)}</div>
    <div class="caption reveal">${escapeHtml(personaSub)}</div>
    ${mediaTag(A.persona, d.base)}`));

  // 8. Stats grid
  out.push(section("grid", `
    <div class="kicker reveal">Angka Lain</div>
    <div class="row2 reveal">
      <div class="stat"><div class="num" data-count="${n(s, "activity.activeDays")}">0</div><div class="lbl">Hari aktif</div></div>
      <div class="stat"><div class="num" data-count="${n(s, "activity.longestStreak")}">0</div><div class="lbl">Streak terpanjang</div></div>
      <div class="stat"><div class="num" data-count="${n(s, "sessions.count")}">0</div><div class="lbl">Sesi chat</div></div>
      <div class="stat"><div class="num" data-count="${n(s, "tools.totalToolCalls")}">0</div><div class="lbl">Tool calls</div></div>
      <div class="stat"><div class="num" data-count="${n(s, "latency.avgMs")}">0</div><div class="lbl">Latency rata² (ms)</div></div>
      <div class="stat"><div class="num" data-count="${n(s, "devices.uniqueCount")}">0</div><div class="lbl">Device dipakai</div></div>
    </div>
    ${s.ide?.favorite ? `<div class="chip reveal">💻 IDE favorit: ${escapeHtml(s.ide.favorite)}</div>` : ""}
    ${s.comparison?.hasPrev ? `<div class="chip reveal">${deltaChip(s.comparison)}</div>` : ""}`));

  // 9. Rank
  const rankReq = d.rank.requests;
  const rankTok = d.rank.tokens;
  const rankT = txt("rank", rankReq ? `Peringkat #${rankReq}` : "Belum berperingkat", "");
  out.push(section("rank", `
    <div class="kicker reveal">Peringkat Kamu</div>
    <div class="headline reveal">${rankT.headline}</div>
    <div class="row2 reveal">
      <div class="stat"><div class="num">${rankReq ? "#" + rankReq : "-"}</div><div class="lbl">Request</div></div>
      <div class="stat"><div class="num">${rankTok ? "#" + rankTok : "-"}</div><div class="lbl">Token</div></div>
    </div>
    <div class="caption reveal">${rankT.caption || (rankReq && rankReq <= 5 ? "Sultan AI! Mecut terus 🔥" : "Terus semangat ngoding!")}</div>
    ${mediaTag(A.rank, d.base)}`));

  // 10. Leaderboard
  out.push(section("leaderboard", `
    <div class="kicker reveal">Papan Peringkat ${escapeHtml(d.monthLabel)}</div>
    <div class="lb-tabs reveal">
      <button class="lb-tab active" data-lb="requests">🏆 Request</button>
      <button class="lb-tab" data-lb="tokens">🪙 Token</button>
    </div>
    <div class="lb reveal" id="lb-requests">${renderLeaderboardList(d.leaderboard.byRequests, d.viewerDiscordUserId, "req")}</div>
    <div class="lb reveal" id="lb-tokens" style="display:none">${renderLeaderboardList(d.leaderboard.byTokens, d.viewerDiscordUserId, "tok")}</div>`));

  // 11. Closing + share
  const closeT = nv.closing || "Sampai jumpa bulan depan!";
  out.push(section("closing", `
    <div class="big reveal">🎉</div>
    <div class="headline reveal">${escapeHtml(closeT)}</div>
    <div class="caption reveal">Bagikan recap kamu ke teman-teman!</div>
    ${mediaTag(A.closing, d.base)}
    <div class="btns reveal">
      <button class="btn" id="shareBtn">📤 Share</button>
      <button class="btn ghost" id="copyBtn">🔗 Salin Link</button>
      <a class="btn ghost" href="https://discord.com/channels/@me" target="_blank" rel="noopener">💬 Discord</a>
    </div>`));

  return out.join("\n");
}

function n2(stats: any, path: string): string {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), stats) ?? "";
  } catch { return ""; }
}

function deltaChip(cmp: any): string {
  const r = cmp.requestsDeltaPercent || 0;
  const cls = r >= 0 ? "delta-up" : "delta-down";
  const arrow = r >= 0 ? "▲" : "▼";
  return `📈 vs bulan lalu: <span class="${cls}">${arrow} ${Math.abs(r)}% request</span>`;
}

const RECAP_JS = `
(function(){
  var rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Reveal on scroll
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); 
      if(e.target.classList.contains('bar')) {}
      countUp(e.target); io.unobserve(e.target);} });
  }, {threshold:0.25});
  document.querySelectorAll('.reveal,.pop,.bar').forEach(function(el){ io.observe(el); });

  function countUp(scope){
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('[data-count]') : [];
    if(scope.hasAttribute && scope.hasAttribute('data-count')) nodes=[scope];
    nodes.forEach(function(el){
      if(el.dataset.done) return; el.dataset.done='1';
      var target = parseInt(el.getAttribute('data-count'))||0;
      if(rm){ el.textContent = format(target); return; }
      var dur=1100, start=performance.now();
      function tick(t){ var p=Math.min(1,(t-start)/dur); var e=1-Math.pow(1-p,3);
        el.textContent=format(Math.round(target*e)); if(p<1) requestAnimationFrame(tick); }
      requestAnimationFrame(tick);
    });
  }
  function format(n){ if(n>=1000000) return (n/1000000).toFixed(1).replace(/\\.0$/,'')+'M';
    if(n>=1000) return (n/1000).toFixed(1).replace(/\\.0$/,'')+'K'; return String(n); }

  // Leaderboard tabs
  document.querySelectorAll('.lb-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.lb-tab').forEach(function(t){t.classList.remove('active')});
      tab.classList.add('active');
      var k=tab.getAttribute('data-lb');
      document.getElementById('lb-requests').style.display = k==='requests'?'':'none';
      document.getElementById('lb-tokens').style.display = k==='tokens'?'':'none';
    });
  });

  // Confetti on rank/closing slide
  var deck=document.querySelector('.deck'); var fired={};
  function confetti(){ if(rm) return; var c=document.createElement('div'); c.className='confetti';
    var cols=['#7c3aed','#ec4899','#f59e0b','#22d3ee','#34d399'];
    for(var i=0;i<80;i++){var s=document.createElement('i');s.style.left=Math.random()*100+'%';
      s.style.background=cols[i%cols.length];s.style.animationDuration=(2+Math.random()*2)+'s';
      s.style.animationDelay=(Math.random()*0.5)+'s';c.appendChild(s);}
    document.body.appendChild(c); setTimeout(function(){c.remove();},4500); }
  var io2=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){var id=e.target.getAttribute('data-slide');
      if((id==='closing'||id==='rank')&&!fired[id]){fired[id]=1;confetti();}}});},{threshold:0.5});
  document.querySelectorAll('.slide').forEach(function(s){io2.observe(s);});

  // Share + copy
  var url=document.body.getAttribute('data-url')||location.href;
  var title=document.body.getAttribute('data-title')||'My Monthly Recap';
  function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('show');
    setTimeout(function(){t.classList.remove('show');},1800);}
  var sb=document.getElementById('shareBtn');
  if(sb) sb.addEventListener('click',function(){
    if(navigator.share){navigator.share({title:title,url:url}).catch(function(){});}
    else{var w='https://twitter.com/intent/tweet?text='+encodeURIComponent(title+' '+url);
      window.open(w,'_blank','noopener');}});
  var cb=document.getElementById('copyBtn');
  if(cb) cb.addEventListener('click',function(){
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(function(){toast('Tersalin!');})
      .catch(function(){fallbackCopy();});} else fallbackCopy();});
  function fallbackCopy(){var i=document.createElement('input');i.value=url;document.body.appendChild(i);
    i.select();try{document.execCommand('copy');toast('Tersalin!');}catch(e){toast('Gagal menyalin');}i.remove();}
})();`;

/** Build OpenGraph/Twitter description without leaking content. */
function ogDescription(d: RecapHtmlData): string {
  const s = d.stats || {};
  const req = fmtNum(n(s, "totals.requests"));
  const tok = fmtNum(n(s, "totals.totalTokens"));
  const rank = d.rank.requests ? `Peringkat #${d.rank.requests}` : "";
  return `${req} request, ${tok} token bulan ${d.monthLabel}. ${rank}`.trim();
}

/** Main entry: full responsive animated recap page. */
export function renderRecapHtml(d: RecapHtmlData): string {
  const title = `Recap ${d.monthLabel} - ${d.displayName}`;
  const desc = ogDescription(d);
  const ogImg = d.avatarUrl || `${d.base}/recap-assets/misc/default.svg`;
  const sections = buildSections(d);

  return `<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(ogImg)}">
<meta property="og:url" content="${escapeHtml(d.pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(ogImg)}">
<style>${RECAP_CSS}</style>
</head>
<body data-url="${escapeHtml(d.pageUrl)}" data-title="${escapeHtml(title)}">
<div class="deck">${sections}</div>
<div class="toast" id="toast"></div>
<script>${RECAP_JS}</script>
</body></html>`;
}



export function renderMessagePage(message: string, base: string): string {
  void base;
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Recap</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100dvh;display:grid;place-items:center;background:#0b0b14;color:#fff;
font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center}
.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:24px;
padding:clamp(24px,6vw,48px);max-width:520px;backdrop-filter:blur(12px)}
h1{font-size:clamp(22px,6vw,32px);margin-bottom:12px}
p{opacity:.8;font-size:clamp(15px,4vw,18px);line-height:1.5}
.emoji{font-size:48px;margin-bottom:8px}
</style></head><body><div class="card"><div class="emoji">📊</div>
<h1>Monthly Recap</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

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
  submitToken?: string | null;
  alreadySubmittedToday?: boolean;
  existingTestimonial?: { stars: number; body: string } | null;
  cleanPath?: string;
  /** Card meta from narrative.card (live anime wallpapers + nested tile plan). */
  cardMeta?: {
    wallpaper: string | null;
    wallpapers: string[];
    defaultThemeId: number;
    tiles: Array<{ key: string; icon: string; label: string; value: string; sub?: string; size: "hero" | "sm" | "wide" | "quote" }>;
    quote: string;
    badge: { icon: string; title: string } | null;
  } | null;
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

/** Micro-dollars -> human dollar string (e.g. 1234567 -> "$1.23"). */
function fmtMoney(micro: number): string {
  const usd = (Number(micro) || 0) / 1_000_000;
  if (usd > 0 && usd < 0.01) return "$" + usd.toFixed(4);
  if (usd < 100) return "$" + usd.toFixed(2);
  return "$" + usd.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function safeJsonForScript(obj: any): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const RECAP_CSS = `
:root{color-scheme:dark;--bg:#0b0b14;--fg:#fff;--muted:rgba(255,255,255,.7);
--g1:#7c3aed;--g2:#ec4899;--g3:#f59e0b;--g4:#22d3ee;--card:rgba(255,255,255,.07);--line:rgba(255,255,255,.14)}
body.theme-gold{--g1:#f59e0b;--g2:#f43f5e;--g4:#fbbf24}
body.theme-night{--g1:#4c1d95;--g2:#7c3aed;--g4:#6366f1;--bg:#070710}
body.theme-cyan{--g1:#06b6d4;--g2:#3b82f6;--g4:#22d3ee}
body.theme-ember{--g1:#ef4444;--g2:#f59e0b;--g4:#fb923c}
body.theme-royal{--g1:#7c3aed;--g2:#f59e0b;--g4:#a855f7}
body.theme-dawn{--g1:#f59e0b;--g2:#ec4899;--g4:#fcd34d}
.navdots{position:fixed;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:7px;z-index:30}
.navdots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.25);transition:background .3s,transform .3s;cursor:pointer}
.navdots i.on{background:var(--g4);transform:scale(1.5)}
@media(max-width:520px){.navdots{right:6px;gap:6px}.navdots i{width:6px;height:6px}}
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
.media{width:auto;max-width:min(86%,420px);max-height:42dvh;border-radius:22px;object-fit:cover;
border:1px solid var(--line);box-shadow:0 18px 50px rgba(0,0,0,.45)}
.reveal{opacity:0;transform:translateY(34px) scale(.96);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
.rv-left{opacity:0;transform:translateX(-60px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-right{opacity:0;transform:translateX(60px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-zoom{opacity:0;transform:scale(.6);transition:opacity .7s cubic-bezier(.2,1.4,.4,1),transform .7s cubic-bezier(.2,1.4,.4,1)}
.rv-tilt{opacity:0;transform:rotate(-6deg) translateY(40px) scale(.92);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.rv-left.in,.rv-right.in,.rv-zoom.in,.rv-tilt.in{opacity:1;transform:none}
.pop{opacity:0;transform:scale(.5)}
.pop.in{opacity:1;transform:scale(1);transition:opacity .6s,transform .6s cubic-bezier(.2,1.4,.4,1)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%}
@media(max-width:520px){.row2{grid-template-columns:1fr}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.bento{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}
@media(max-width:520px){.bento{grid-template-columns:1fr 1fr}}
.bento2{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:74px;gap:10px;width:100%;max-width:560px}
.b2{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:var(--card);
display:flex;flex-direction:column;justify-content:center;padding:12px 14px;text-align:left;
transition:transform .2s,box-shadow .2s}
.b2:hover{transform:translateY(-4px);box-shadow:0 12px 28px rgba(0,0,0,.35)}
.b2-anchor{grid-column:span 2;grid-row:span 2;background:linear-gradient(140deg,rgba(124,58,237,.32),rgba(236,72,153,.18),var(--card))}
.b2-wide{grid-column:span 2;flex-direction:row;align-items:center;gap:12px;background:linear-gradient(140deg,rgba(34,211,238,.2),var(--card))}
.b2-sm{background:linear-gradient(140deg,rgba(255,255,255,.06),var(--card))}
.b2-sm:nth-of-type(3n){background:linear-gradient(140deg,rgba(245,158,11,.16),var(--card))}
.b2-ic{font-size:38px;line-height:1}
.b2-ic-sm{font-size:24px;line-height:1}
.b2-num{font-size:clamp(34px,9vw,52px);font-weight:900;line-height:1;margin-top:6px}
.b2-num-sm{font-size:clamp(20px,5.5vw,28px);font-weight:900;line-height:1;margin-top:3px}
.b2-lbl{font-size:14px;font-weight:700;margin-top:4px}
.b2-lbl-sm{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.b2-quip{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.35}
.b2-wide-tx{display:flex;flex-direction:column}
.bento-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:14px}
@media(max-width:520px){.bento2{grid-auto-rows:64px;gap:8px}.b2-anchor{grid-row:span 2}}
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
.testi{margin-top:18px;max-width:520px;text-align:left}
.testi-title{font-size:clamp(18px,5vw,24px);font-weight:900;margin-bottom:6px}
.stars{display:flex;gap:6px;margin:14px 0;font-size:clamp(30px,9vw,44px);line-height:1;justify-content:center}
.star{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.25);transition:transform .15s,color .15s;padding:0}
.star:hover{transform:scale(1.15)}
.star.on{color:#f59e0b;text-shadow:0 0 18px rgba(245,158,11,.6)}
.testi textarea{width:100%;border-radius:14px;border:1px solid var(--line);background:rgba(0,0,0,.25);
color:#fff;padding:12px 14px;font-size:15px;font-family:inherit;resize:vertical;margin-bottom:12px}
.testi-done{display:none;margin-top:10px;color:#34d399;font-weight:700}
.bcr{margin-top:8px;position:relative}
.bcr-tabs{display:flex;gap:8px;justify-content:center;margin-bottom:12px}
.bcr-tab{background:var(--card);border:1px solid var(--line);color:var(--fg);border-radius:999px;
padding:9px 18px;font-weight:700;cursor:pointer;font-size:14px}
.bcr-tab.active{background:linear-gradient(120deg,var(--g1),var(--g2));border-color:transparent}
.bcr-day{font-weight:900;font-size:clamp(16px,5vw,22px);color:var(--g3);text-align:center;margin-bottom:14px;letter-spacing:.04em}
.bcr-rows{position:relative}
.bcr-row{position:absolute;left:0;right:0;height:38px;display:grid;grid-template-columns:26px 1fr;
align-items:center;gap:8px;transition:transform .7s cubic-bezier(.45,.05,.3,1)}
.bcr-rank{font-weight:800;font-size:12px;color:var(--muted);text-align:right}
.bcr-bar{position:relative;height:32px;border-radius:10px;background:rgba(255,255,255,.08);overflow:hidden}
.bcr-fill{position:absolute;inset:0;width:0;border-radius:10px;background:linear-gradient(90deg,var(--g1),var(--g2));
transition:width .55s cubic-bezier(.3,.7,.3,1)}
.bcr-row.me .bcr-fill{background:linear-gradient(90deg,var(--g3),#ffd56b)}
.bcr-row.me .bcr-name{color:#fff;font-weight:900}
.bcr-meta{position:absolute;inset:0;display:flex;align-items:center;gap:8px;padding:0 10px;z-index:1}
.bcr-av{width:22px;height:22px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:rgba(255,255,255,.2)}
.bcr-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.92)}
.bcr-val{margin-left:auto;font-weight:800;font-size:13px;flex:0 0 auto}
.testi-done.show{display:block}
.delta-up{color:#34d399}.delta-down{color:#f87171}
.badges{display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px}
.badge{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;text-align:left}
.trophy{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;max-width:540px}
@media(max-width:520px){.trophy{grid-template-columns:1fr 1fr}}
.trophy-badge{position:relative;overflow:hidden;background:linear-gradient(150deg,rgba(245,158,11,.18),var(--card));
border:1px solid var(--line);border-radius:18px;padding:14px 12px;text-align:center}
.tb-ic{font-size:34px;line-height:1;filter:drop-shadow(0 3px 8px rgba(0,0,0,.4))}
.tb-title{font-size:13px;font-weight:900;margin-top:6px}
.tb-desc{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.3}
.tb-shine{position:absolute;top:0;left:-60%;width:40%;height:100%;
background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);
transform:skewX(-20deg);animation:shine 3.5s ease-in-out infinite}
@keyframes shine{0%,60%{left:-60%}100%{left:140%}}
@media(prefers-reduced-motion:reduce){.tb-shine{animation:none;display:none}}
.badge-ic{font-size:30px;flex:0 0 auto}
.badge-tx{display:flex;flex-direction:column}
.badge-tx b{font-size:15px}
.badge-tx span{font-size:13px;color:var(--muted)}
.facts{display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px;text-align:left}
.fact{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:15px;line-height:1.4}
.bubbles{display:flex;flex-direction:column;gap:14px;width:100%;max-width:540px}
.bubble{position:relative;display:flex;align-items:flex-start;gap:10px;max-width:88%;
background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 16px;font-size:15px;line-height:1.45}
.bb-left{align-self:flex-start;border-bottom-left-radius:4px;background:linear-gradient(135deg,rgba(124,58,237,.2),var(--card))}
.bb-right{align-self:flex-end;border-bottom-right-radius:4px;background:linear-gradient(135deg,rgba(236,72,153,.2),var(--card))}
.bb-left::after{content:"";position:absolute;left:-6px;bottom:8px;width:14px;height:14px;background:inherit;border-left:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(45deg)}
.bb-right::after{content:"";position:absolute;right:-6px;bottom:8px;width:14px;height:14px;background:inherit;border-right:1px solid var(--line);border-bottom:1px solid var(--line);transform:rotate(-45deg)}
.bubble-ic{font-size:22px;flex:0 0 auto}
.bubble-tx{flex:1}
.heat{width:100%;max-width:520px}
.heat-grid{display:flex;flex-direction:column;gap:3px}
.heat-row{display:flex;align-items:center;gap:3px}
.heat-lbl{font-size:10px;color:var(--muted);width:14px;flex:0 0 auto}
.heat-row i{flex:1;aspect-ratio:1;border-radius:2px;background:var(--g4);min-width:0}
.heat-peak{outline:2px solid #fff;outline-offset:1px;border-radius:3px!important}
.heat-foot{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.heat-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);justify-content:center}
.heat-legend i{width:12px;height:12px;border-radius:2px;background:var(--g4);display:inline-block}
.heat-peak-lbl{font-size:12px;font-weight:700;color:var(--g3);text-align:center}
.heat-axis{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--muted);padding-left:17px}

/* === V2 shareable recap card: live wallpaper + nested glass cards ======= */
.wrapcard{position:relative;width:100%;max-width:380px;aspect-ratio:1/1.55;border-radius:28px;overflow:hidden;
border:1px solid rgba(255,255,255,.28);box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.06);isolation:isolate;background:#0b0b14}
.wc-wall{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;
transform:scale(1.06);animation:wcPan 18s ease-in-out infinite alternate;will-change:transform}
@keyframes wcPan{0%{transform:scale(1.06) translate(0,0)}100%{transform:scale(1.12) translate(-2%,-2%)}}
.wc-fallback{position:absolute;inset:0;z-index:0;background:linear-gradient(160deg,var(--wc-a,#7c3aed),var(--wc-b,#ec4899));background-size:220% 220%;animation:wcflow 7s ease infinite}
@keyframes wcflow{0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
.wc-scrim{position:absolute;inset:0;z-index:1;pointer-events:none;
background:linear-gradient(180deg,var(--wc-scrim,rgba(10,0,30,0.2)) 0%,var(--wc-scrim,rgba(10,0,30,0.2)) 30%,var(--wc-scrimEnd,rgba(10,0,30,0.85)) 100%)}
.wc-stack{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;gap:7px;padding:12px 12px 14px;color:var(--wc-text,#fff)}
/* Subtler glass — "barely there but present" */
.wc-glass{position:relative;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);
border-radius:18px;backdrop-filter:blur(20px) saturate(120%);-webkit-backdrop-filter:blur(20px) saturate(120%);
box-shadow:none;padding:10px 12px}
.wc-id{display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,.18);border-color:rgba(255,255,255,.14)}
.wc-id .av{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.7);flex:0 0 auto;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.wc-id .name{font-size:16px;font-weight:900;line-height:1.05;letter-spacing:-.01em;color:var(--wc-text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.wc-id .persona{font-size:11px;font-weight:800;color:var(--wc-muted,rgba(255,255,255,.85));text-transform:uppercase;letter-spacing:.08em;margin-top:1px}
.wc-mosaic{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:74px;gap:9px}
.wc-tile{position:relative;display:flex;flex-direction:column;justify-content:center;overflow:hidden;padding:11px 12px;gap:3px;
background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.16);border-radius:14px;
backdrop-filter:blur(12px) saturate(110%);-webkit-backdrop-filter:blur(12px) saturate(110%)}
.wc-tile.hero{grid-column:span 2;grid-row:span 2;padding:14px 14px;gap:6px}
.wc-tile.wide{grid-column:span 2;flex-direction:row;align-items:center;gap:10px}
.wc-tile .ti{font-size:20px;line-height:1;flex:0 0 auto}
.wc-tile.hero .ti{font-size:30px}
.wc-tile.wide .ti{font-size:24px}
/* Rainbow glossy animated stat number — solid white fallback + shadow for legibility */
.wc-tile .tv{font-weight:900;line-height:1;font-size:clamp(20px,5.2vw,27px);
color:#fff;text-shadow:0 0 1px rgba(0,0,0,.45),0 1px 2px rgba(0,0,0,.35);
background:linear-gradient(90deg,#ff4d6d,#ffd93d,#6ee7b7,#22d3ee,#a78bfa,#f472b6,#ff4d6d);
background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
animation:tvRainbow 6s linear infinite;letter-spacing:-.02em}
@keyframes tvRainbow{0%{background-position:0 0}100%{background-position:300% 0}}
.wc-tile.hero .tv{font-size:clamp(34px,9vw,52px)}
.wc-tile .tl{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--wc-muted,rgba(255,255,255,.85));margin-top:4px}
.wc-tile.hero .tl{font-size:12px;margin-top:6px}
.wc-tile .ts{font-size:10px;color:var(--wc-muted,rgba(255,255,255,.7));margin-top:2px;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-tile.wide .tx{display:flex;flex-direction:column;min-width:0}
.wc-tile.wide .tv{font-size:clamp(15px,3.8vw,19px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-tile.wide .tl{margin-top:0}
.wc-tile .tglow{position:absolute;right:-30%;bottom:-30%;width:120px;height:120px;border-radius:50%;
background:radial-gradient(closest-side,var(--wc-a,#fff),transparent 70%);opacity:.18;pointer-events:none}
.wc-quote{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;min-height:48px;background:rgba(0,0,0,.25);border-color:rgba(255,255,255,.12);font-size:12px}
.wc-quote .qi{font-size:20px;line-height:1;flex:0 0 auto}
.wc-quote .qx{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--wc-text,#fff);font-style:italic}
.wc-badge{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;padding:6px 11px;border-radius:999px;background:rgba(0,0,0,.3);border-color:rgba(255,255,255,.18)}
.wc-badge .bi{font-size:18px;line-height:1}
.wc-badge .bt{font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}
.wc-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 6px 4px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--wc-muted,rgba(255,255,255,.9))}
.wc-foot .brand{opacity:.95}
.wc-themes-wrap{width:100%;max-width:380px;margin-top:14px;display:flex;flex-direction:column;gap:8px;align-items:center}
.wc-themes{position:relative;width:100%;max-height:170px;overflow-y:auto;overflow-x:hidden;padding:4px;
display:grid;grid-template-columns:repeat(10,1fr);gap:6px;
background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:16px;
scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
.wc-themes::-webkit-scrollbar{width:6px}
.wc-themes::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:3px}
.wc-sw{width:100%;aspect-ratio:1;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform .15s,border-color .15s;position:relative;flex:0 0 auto;background-size:cover;background-position:center;padding:0;outline:0}
.wc-sw:hover{transform:scale(1.1)}
.wc-sw.on{border-color:#fff;transform:scale(1.18);box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.wc-themes-hint{font-size:11px;color:var(--muted);text-align:center}
.wc-themes.wc-locked{opacity:.45;pointer-events:none;filter:saturate(.4)}
@media(max-width:420px){.wrapcard{aspect-ratio:1/1.65}.wc-mosaic{grid-auto-rows:68px;gap:7px}.wc-stack{padding:10px 10px 12px;gap:6px}.wc-foot{font-size:11px;padding:10px 4px 2px}.wc-id .av{width:38px;height:38px}.wc-tile.hero .tv{font-size:clamp(28px,7vw,42px)}}
/* Snap mode: html2canvas-compatible flat rendering for downloads. Kills
   background-clip:text and backdrop-filter so text + glass survive capture. */
body.wc-snap .wc-tile .tv{visibility:hidden!important;animation:none!important}
body.wc-snap .wc-tile .tl,body.wc-snap .wc-tile .ts,body.wc-snap .wc-tile .ti,
body.wc-snap .wc-quote .qx,body.wc-snap .wc-quote .qi,
body.wc-snap .wc-badge .bt,body.wc-snap .wc-badge .bi,
body.wc-snap .wc-id .name,body.wc-snap .wc-id .persona{color:#fff!important;
  -webkit-text-fill-color:#fff!important;background-image:none!important;
  -webkit-background-clip:initial!important;background-clip:initial!important;
  text-shadow:0 1px 2px rgba(0,0,0,.45)}
body.wc-snap .wc-tile,body.wc-snap .wc-glass,body.wc-snap .wc-quote,body.wc-snap .wc-badge{
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
body.wc-snap .wc-tile{background:rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.18)!important}
body.wc-snap .wc-quote{background:rgba(0,0,0,.32)!important}
body.wc-snap .wc-badge{background:rgba(0,0,0,.36)!important}
body.wc-snap .wc-foot{color:rgba(255,255,255,.95)!important}
body.wc-snap .wc-id{background:rgba(0,0,0,.32)!important}
@media(prefers-reduced-motion:reduce){.wc-wall,.wc-fallback{animation:none}.wc-tile .tv{animation:none}}
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
  // GIF/meme as centerpiece. For external (searched) GIFs, on error swap to the
  // local default meme SVG so a dead link never shows a broken image.
  return `<img class="media reveal" loading="lazy" referrerpolicy="no-referrer" alt="" src="${escapeHtml(asset.url)}"
    onerror="this.onerror=null;this.src='${escapeHtml(fallback)}'">`;
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

  // 3b. Cost — what Groupy spends on your AI usage
  const cost = s.cost;
  if (cost && (cost.totalMicro > 0)) {
    const maxC = Math.max(cost.inputMicro || 0, cost.outputMicro || 0, 1);
    const inCPct = Math.round(((cost.inputMicro || 0) / maxC) * 100);
    const outCPct = Math.round(((cost.outputMicro || 0) / maxC) * 100);
    out.push(section("cost", `
      <div class="kicker reveal">Biaya Groupy buat Kamu</div>
      <div class="big reveal">${fmtMoney(cost.totalMicro)}</div>
      <div class="card reveal">
        <div class="bars">
          <div><div class="barlbl"><span>📥 Input</span><span>${fmtMoney(cost.inputMicro)}</span></div>
            <div class="bar" style="--w:${inCPct}%"><span class="b-in"></span></div></div>
          <div><div class="barlbl"><span>📤 Output</span><span>${fmtMoney(cost.outputMicro)}</span></div>
            <div class="bar" style="--w:${outCPct}%"><span class="b-out"></span></div></div>
        </div>
      </div>
      ${cost.mostExpensiveModel ? `<div class="chip reveal">💸 Termahal: ${escapeHtml(cost.mostExpensiveModel.model)} (${fmtMoney(cost.mostExpensiveModel.micro)})</div>` : ""}
      ${cost.cheapestModel ? `<div class="chip reveal">🪙 Termurah: ${escapeHtml(cost.cheapestModel.model)} (${fmtMoney(cost.cheapestModel.micro)})</div>` : ""}
      ${cost.mostExpensiveDay ? `<div class="chip reveal">📅 Hari paling boros: ${escapeHtml(cost.mostExpensiveDay.day)} (${fmtMoney(cost.mostExpensiveDay.micro)})</div>` : ""}
      ${cost.mostExpensiveHour !== null && cost.mostExpensiveHour ? `<div class="chip reveal">⏰ Jam paling boros: ${cost.mostExpensiveHour.hour}:00 WIB (${fmtMoney(cost.mostExpensiveHour.micro)})</div>` : ""}
      <div class="caption reveal">Segini yang Groupy keluarin biar kamu bisa ngoding bareng AI. 🙏</div>
      ${mediaTag(A.tokens, d.base)}`));
  }

  // 4. Favorite model
  const favT = txt("favoriteModel", escapeHtml(n2(s, "models.favorite") || "-"), "Model andalan kamu.");
  out.push(section("favoriteModel", `
    <div class="kicker reveal">Model Favorit</div>
    <div class="headline reveal">${favT.headline}</div>
    <div class="chip reveal">⭐ ${escapeHtml(n2(s, "models.favorite") || "-")}</div>
    <div class="caption reveal">${favT.caption}</div>
    ${mediaTag(A.favoriteModel, d.base)}`));

  // 5. Least used model (paling sedikit request)
  const least = (s.models?.leastUsed || [])[0];
  if (least) {
    const leastT = txt("leastModel", escapeHtml(least.model), `Cuma ${least.requests || 0}x dipanggil. Kita kan teman? 🥲`);
    out.push(section("leastModel", `
      <div class="kicker reveal">Yang Terlupakan</div>
      <div class="headline reveal">${leastT.headline}</div>
      <div class="chip reveal">😶 ${escapeHtml(least.model)} — ${fmtNum(least.requests || 0)}x</div>
      <div class="caption reveal">${leastT.caption}</div>
      ${mediaTag(A.leastModel, d.base)}`));
  }

  // 5b. Fastest model (lowest avg latency)
  const fastest = s.models?.fastest;
  if (fastest && fastest.model) {
    out.push(section("fastestModel", `
      <div class="kicker reveal">Model Tercepat</div>
      <div class="headline reveal">${escapeHtml(fastest.model)}</div>
      <div class="chip reveal">⚡ rata-rata ${fmtNum(fastest.avgLatencyMs || 0)}ms</div>
      <div class="caption reveal">Ngebut, jawab kilat tanpa drama.</div>
      ${mediaTag(A.fastestModel, d.base)}`));
  }

  // 5c. Slowest model (highest avg latency)
  const slowest = s.models?.slowest;
  if (slowest && slowest.model && (!fastest || slowest.model !== fastest.model)) {
    out.push(section("slowestModel", `
      <div class="kicker reveal">Model Terlemot</div>
      <div class="headline reveal">${escapeHtml(slowest.model)}</div>
      <div class="chip reveal">🐌 rata-rata ${fmtNum(slowest.avgLatencyMs || 0)}ms</div>
      <div class="caption reveal">Sabar ya, dia mikir keras dulu.</div>
      ${mediaTag(A.slowestModel, d.base)}`));
  }

  // 6. Active time
  const hr = n(s, "activity.mostActiveHour.hour", -1);
  const actT = txt("activeTime", hr >= 0 ? `${hr}:00 WIB` : "-", "Waktu paling produktif kamu.");
  out.push(section("activeTime", `
    <div class="kicker reveal">Jam Sibuk</div>
    <div class="big reveal">${hr >= 0 ? hr + ":00" : "-"}</div>
    <div class="caption reveal">${actT.caption}</div>
    ${s.activity?.favoriteWeekday ? `<div class="chip reveal">📅 Paling rajin hari ${escapeHtml(s.activity.favoriteWeekday)}</div>` : ""}
    ${s.activity?.mostProductiveHour ? `<div class="chip reveal">⚡ Jam paling produktif: ${n(s, "activity.mostProductiveHour.hour")}:00 WIB</div>` : ""}
    ${s.activity?.mostActiveDay ? `<div class="chip reveal">🔥 Hari paling aktif: ${escapeHtml(s.activity.mostActiveDay.day)} (${fmtNum(n(s, "activity.mostActiveDay.requests"))} req)</div>` : ""}
    ${(n(s, "activity.weekendRequests") + n(s, "activity.weekdayRequests")) > 0 ? `<div class="chip reveal">🗓️ Weekday ${fmtNum(n(s, "activity.weekdayRequests"))} vs Weekend ${fmtNum(n(s, "activity.weekendRequests"))}</div>` : ""}
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
    <div class="bento2 reveal">
      ${bentoBig("🛠️", fmtNum(n(s, "tools.totalToolCalls")), "Tool calls", "Agentic sejati — nyuruh AI mulu.")}
      ${bentoSm("📆", n(s, "activity.activeDays"), "Hari aktif")}
      ${bentoSm("🔥", n(s, "activity.longestStreak"), "Streak")}
      ${bentoSm("💬", n(s, "sessions.count"), "Sesi chat")}
      ${bentoSm("⏱️", fmtNum(n(s, "latency.avgMs")), "Latency (ms)")}
      ${bentoWide("🤖", n(s, "tools.toolTurnPercent") + "%", "turn pakai tool", "Tukang suruh AI.")}
      ${bentoSm("💻", n(s, "devices.uniqueCount"), "Device")}
    </div>
    <div class="bento-chips reveal">
      ${s.ide?.favorite ? `<div class="chip">💻 IDE favorit: ${escapeHtml(s.ide.favorite)}</div>` : ""}
      ${s.comparison?.hasPrev ? `<div class="chip">${deltaChip(s.comparison)}</div>` : ""}
    </div>`));

  // 8b. Achievements / badges (AI-generated preferred, deterministic fallback)
  const ach = ((nv.badges && nv.badges.length ? nv.badges : s.extras?.achievements) || []) as Array<{ icon: string; title: string; desc: string }>;
  if (ach.length) {
    out.push(section("ach", `
      <div class="kicker reveal">Lencana Kamu</div>
      <div class="headline reveal">${ach.length} Badge Kekunci 🏅</div>
      <div class="trophy reveal">
        ${ach.slice(0, 10).map((b) => `<div class="trophy-badge"><div class="tb-shine"></div><div class="tb-ic">${b.icon}</div><div class="tb-title">${escapeHtml(b.title)}</div><div class="tb-desc">${escapeHtml(b.desc)}</div></div>`).join("")}
      </div>
      ${mediaTag(A.persona, d.base)}`));
  }

  // 8c. Fun facts
  const facts = (s.extras?.funFacts || []) as string[];
  if (facts.length) {
    out.push(section("facts", `
      <div class="kicker reveal">Fakta Iseng</div>
      <div class="headline reveal">Tau Gak? 🤔</div>
      <div class="bubbles">${facts.slice(0, 4).map((f, i) => `<div class="bubble ${i % 2 === 0 ? "bb-left" : "bb-right"} reveal"><span class="bubble-ic">${["🤯", "👀", "🔥", "💡"][i % 4]}</span><span class="bubble-tx">${escapeHtml(f)}</span></div>`).join("")}</div>
      ${mediaTag(A.requests, d.base)}`));
  }

  // 8d. Heatmap jam x hari
  const heat = buildHeatmap(s);
  if (heat) {
    out.push(section("heatmap", `
      <div class="kicker reveal">Kapan Kamu Ngoding</div>
      <div class="headline reveal">Pola Jam x Hari</div>
      <div class="heat card reveal">${heat}</div>
      <div class="caption reveal">Makin terang, makin sering kamu nyiksa AI di jam itu. 🔥</div>`));
  }

  // 8e. Hari sepi / libur
  const rest = s.extras?.restWeekday;
  const quiet = s.activity?.quietestActiveDay;
  if (rest || quiet) {
    out.push(section("rest", `
      <div class="kicker reveal">Hari Santai</div>
      <div class="headline reveal">${rest ? `Kamu Libur Tiap ${escapeHtml(rest)}` : "Hari Tersepi"}</div>
      ${quiet ? `<div class="chip reveal">😴 Paling sepi: ${escapeHtml(quiet.day)} (${fmtNum(n(s, "activity.quietestActiveDay.requests"))} req)</div>` : ""}
      ${s.activity?.firstActiveDay ? `<div class="chip reveal">🚀 Mulai aktif: ${escapeHtml(s.activity.firstActiveDay)}</div>` : ""}
      <div class="caption reveal">Semua orang butuh rebahan. 🛌</div>
      ${mediaTag(A.activeTime, d.base)}`));
  }

  // 8f. Banding komunitas
  const comm = s.extras?.community;
  if (comm && (comm.requestPercentile > 0 || comm.tokenPercentile > 0)) {
    out.push(section("community", `
      <div class="kicker reveal">Kamu vs Komunitas</div>
      <div class="big reveal">Top ${Math.max(1, 100 - comm.requestPercentile)}%</div>
      <div class="caption reveal">Kamu lebih rajin dari <b>${comm.requestPercentile}%</b> developer Groupy${comm.tokenPercentile ? `, dan lebih boros token dari <b>${comm.tokenPercentile}%</b>` : ""}. 📊</div>
      ${mediaTag(A.rank, d.base)}`));
  }

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

  // 9a. Request tercepat & terlama
  const fastMs = n(s, "latency.fastestMs");
  const slowMs = n(s, "latency.slowestMs");
  if (fastMs > 0 || slowMs > 0) {
    out.push(section("latency", `
      <div class="kicker reveal">Kecepatan Respon</div>
      <div class="headline reveal">Tercepat vs Terlama</div>
      <div class="row2 reveal">
        <div class="stat"><div class="num">${fastMs > 0 ? fmtNum(fastMs) : "-"}</div><div class="lbl">Tercepat (ms)</div></div>
        <div class="stat"><div class="num">${slowMs > 0 ? fmtNum(slowMs) : "-"}</div><div class="lbl">Terlama (ms)</div></div>
      </div>
      <div class="caption reveal">Yang cepet bikin senyum, yang lama bikin sabar. ⏳</div>`));
  }

  // 9c. Prediksi bulan depan
  const proj = s.extras?.projection;
  if (proj && proj.requests > 0) {
    out.push(section("projection", `
      <div class="kicker reveal">Ramalan Bulan Depan</div>
      <div class="headline reveal">Kalau Lanjut Segini...</div>
      <div class="row2 reveal">
        <div class="stat"><div class="num">${fmtNum(proj.requests)}</div><div class="lbl">Estimasi request</div></div>
        <div class="stat"><div class="num">${fmtNum(proj.tokens)}</div><div class="lbl">Estimasi token</div></div>
      </div>
      ${proj.costMicro > 0 ? `<div class="chip reveal">💸 Estimasi biaya: ${fmtMoney(proj.costMicro)}</div>` : ""}
      <div class="caption reveal">Bukan ramalan dukun, ini matematika. 🔮</div>
      ${mediaTag(A.requests, d.base)}`));
  }

  // 9b. Leaderboard timelapse (bar-chart-race, day 1 -> today). Toggle Request/Token.
  const race = s.race;
  const trackReq = race?.byRequests;
  const trackTok = race?.byTokens;
  const hasReq = !!(trackReq && Array.isArray(trackReq.users) && trackReq.users.length >= 2);
  const hasTok = !!(trackTok && Array.isArray(trackTok.users) && trackTok.users.length >= 2);
  if (race && Array.isArray(race.days) && race.days.length >= 2 && (hasReq || hasTok)) {
    const defMode = hasReq ? "requests" : "tokens";
    const myReqRank = trackReq?.myRank;
    const tabs = `
      <div class="bcr-tabs reveal">
        ${hasReq ? `<button class="bcr-tab${defMode === "requests" ? " active" : ""}" data-mode="requests">🏆 By Request</button>` : ""}
        ${hasTok ? `<button class="bcr-tab${defMode === "tokens" ? " active" : ""}" data-mode="tokens">🪙 By Token</button>` : ""}
      </div>`;
    const cap = myReqRank
      ? (myReqRank <= 3 ? `Kamu finish di #${myReqRank}. Gokil! 🏆` : `Kamu naik ke #${myReqRank}. Lihat perjuangannya!`)
      : "Lihat perjalanan peringkat kamu sepanjang bulan.";
    out.push(section("race", `
      <div class="kicker reveal">Perjalanan Peringkat</div>
      <div class="headline reveal">Dari Tanggal 1 Sampai Sekarang</div>
      ${tabs}
      <div class="bcr card reveal" id="bcrBox"
        data-days='${escapeHtml(JSON.stringify(race.days))}'
        data-req='${escapeHtml(JSON.stringify(trackReq || null))}'
        data-tok='${escapeHtml(JSON.stringify(trackTok || null))}'
        data-mode='${defMode}'>
        <div class="bcr-day" id="bcrDay">&nbsp;</div>
        <div class="bcr-rows" id="bcrRows"></div>
      </div>
      <div class="caption reveal">${escapeHtml(cap)}</div>`));
  }

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
  // 10b. V2 Wrapped Card (live anime wallpaper + nested glass tiles)
  const persona = nv.persona || {};
  const cardMeta = d.cardMeta || {
    wallpaper: null,
    wallpapers: [],
    defaultThemeId: 0,
    tiles: [
      { key: "requests", icon: "🚀", label: "Request", value: fmtNum(n(s, "totals.requests")), sub: "Bulan ini", size: "hero" },
      { key: "rank", icon: "🏆", label: "Peringkat", value: d.rank.requests ? "#" + d.rank.requests : "—", sub: "dari semua developer", size: "sm" },
      { key: "tokens", icon: "🪙", label: "Token", value: fmtNum(n(s, "totals.totalTokens")), sub: "Input + output", size: "sm" },
    ],
    quote: persona.subtitle || "Bulan yang produktif! Terus gas ya.",
    badge: (nv.badges && nv.badges[0]) ? { icon: nv.badges[0].icon, title: nv.badges[0].title } : null,
  };
  const initialWallpaper = cardMeta.wallpapers[0] || cardMeta.wallpaper || "";
  // Wide tiles need a different inner structure; render with tx wrapper when present
  const tilesFinal = cardMeta.tiles.map((t) => {
    const sub = t.sub ? `<div class="ts">${escapeHtml(t.sub)}</div>` : "";
    if (t.size === "wide") {
      return `<div class="wc-tile wide"><div class="tglow"></div><div class="ti">${t.icon}</div><div class="tx"><div class="tv">${escapeHtml(t.value)}</div><div class="tl">${escapeHtml(t.label)}</div>${sub}</div></div>`;
    }
    return `<div class="wc-tile ${escapeHtml(t.size)}"><div class="tglow"></div><div class="ti">${t.icon}</div><div class="tv">${escapeHtml(t.value)}</div><div class="tl">${escapeHtml(t.label)}</div>${sub}</div>`;
  }).join("");
  out.push(section("card", `
    <div class="kicker reveal">Kartu Recap Kamu</div>
    <div class="wrapcard reveal" id="wrapCard"
      data-walls='${escapeHtml(JSON.stringify(cardMeta.wallpapers))}'
      data-theme='${cardMeta.defaultThemeId || 0}'>
      <div class="wc-fallback" id="wcFallback"></div>
      <img class="wc-wall" id="wcWall" crossorigin="anonymous" alt=""
        src="${escapeHtml(initialWallpaper)}"
        onerror="this.style.display='none';document.getElementById('wcFallback').style.display='block';" />
      <div class="wc-scrim"></div>
      <div class="wc-stack">
        <div class="wc-glass wc-id">
          ${d.avatarUrl ? `<img class="av" crossorigin="anonymous" src="${escapeHtml(d.avatarUrl)}" alt="" onerror="this.style.display='none'">` : "<div class=\"av\" style=\"background:rgba(255,255,255,.2)\"></div>"}
          <div style="min-width:0;flex:1">
            <div class="name">${escapeHtml(d.displayName)}</div>
            <div class="persona">${escapeHtml(persona.title || "Coder")}</div>
          </div>
        </div>
        <div class="wc-mosaic">${tilesFinal}</div>
        <div class="wc-glass wc-quote">
          <div class="qi">💬</div>
          <div class="qx">"${escapeHtml(cardMeta.quote)}"</div>
        </div>
        ${cardMeta.badge ? `<div class="wc-glass wc-badge"><div class="bi">${cardMeta.badge.icon}</div><div class="bt">${escapeHtml(cardMeta.badge.title)}</div></div>` : ""}
        <div class="wc-foot">
          <span>Wrapped ${escapeHtml(d.monthLabel)}</span>
          <span class="brand">✦ Groupy</span>
        </div>
      </div>
    </div>
    <div class="wc-themes-wrap reveal">
      <div class="wc-themes" id="wcThemes"></div>
      <div class="wc-themes-hint">Pilih wallpaper lain — klik untuk ganti</div>
    </div>
    <div class="btns reveal">
      <button class="btn" id="dlBtn">⬇️ Download Kartu (GIF)</button>
    </div>
    <div class="caption reveal" id="dlStatus">Ganti tema, klik download — nanti di-render ke GIF 📸</div>`));

  out.push(section("closing", `
    <div class="big reveal">🎉</div>
    <div class="headline reveal">${escapeHtml(closeT)}</div>
    <div class="caption reveal">Bagikan recap kamu ke teman-teman!</div>
    ${mediaTag(A.closing, d.base)}
    <div class="btns reveal">
      <button class="btn" id="shareBtn">📤 Share</button>
      <button class="btn ghost" id="copyBtn">🔗 Salin Link</button>
      <a class="btn ghost" href="https://discord.com/channels/@me" target="_blank" rel="noopener">💬 Discord</a>
    </div>
    ${buildTestimonialBlock(d)}`));

  return out.join("\n");
}

function buildTestimonialBlock(d: RecapHtmlData): string {
  const canSubmit = !!d.submitToken;
  // No valid day-token (e.g. shared/copied clean link) -> render NOTHING.
  if (!canSubmit) return "";

  const existing = d.existingTestimonial;
  const prefillStars = existing?.stars || 0;
  const prefillBody = existing ? escapeHtml(existing.body) : "";

  // Valid token but already submitted today -> show a thank-you note (no form).
  if (d.alreadySubmittedToday && existing) {
    return `<div class="testi card reveal"><div class="testi-title">💬 Testimoni</div>
      <div class="caption">Kamu udah kasih testimoni ${"★".repeat(existing.stars)}${"☆".repeat(5 - existing.stars)} hari ini. Makasih! Balik lagi besok ya 🙌</div></div>`;
  }
  return `<div class="testi card reveal" id="testiBox">
    <div class="testi-title">💬 Tinggalkan Testimoni</div>
    <div class="caption">Gimana pengalaman ngoding kamu bulan ini? Kasih bintang & cerita singkat.</div>
    <div class="stars" id="starPick" role="radiogroup" aria-label="Rating bintang">
      ${[1, 2, 3, 4, 5].map((i) => `<button type="button" class="star" data-v="${i}" aria-label="${i} bintang">★</button>`).join("")}
    </div>
    <textarea id="testiText" maxlength="500" rows="3" placeholder="Tulis testimoni kamu di sini...">${prefillBody}</textarea>
    <button class="btn" id="testiSubmit">Kirim Testimoni</button>
    <div class="testi-done" id="testiDone">Makasih! Testimoni kamu tersimpan 🙌</div>
    <script>window.__RECAP_SUBMIT_TOKEN=${JSON.stringify(d.submitToken)};window.__RECAP_USER_ID=${JSON.stringify(d.viewerDiscordUserId || "")};window.__RECAP_YM=${JSON.stringify(d.yearMonth)};window.__RECAP_PREFILL_STARS=${prefillStars};</script>
  </div>`;
}

function n2(stats: any, path: string): string {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), stats) ?? "";
  } catch { return ""; }
}

/** Bento anchor (2x2) tile: big emoji, big number, label, meme quip. */
function bentoBig(icon: string, value: string | number, label: string, quip: string): string {
  return `<div class="b2 b2-anchor"><div class="b2-ic">${icon}</div>
    <div class="b2-num">${escapeHtml(String(value))}</div>
    <div class="b2-lbl">${escapeHtml(label)}</div>
    <div class="b2-quip">${escapeHtml(quip)}</div></div>`;
}
/** Bento small (1x1) tile. */
function bentoSm(icon: string, value: string | number, label: string): string {
  return `<div class="b2 b2-sm"><div class="b2-ic-sm">${icon}</div>
    <div class="b2-num-sm">${escapeHtml(String(value))}</div>
    <div class="b2-lbl-sm">${escapeHtml(label)}</div></div>`;
}
/** Bento wide (2x1) tile with quip. */
function bentoWide(icon: string, value: string | number, label: string, quip: string): string {
  return `<div class="b2 b2-wide"><div class="b2-ic-sm">${icon}</div>
    <div class="b2-wide-tx"><div class="b2-num-sm">${escapeHtml(String(value))} <span class="b2-lbl-sm">${escapeHtml(label)}</span></div>
    <div class="b2-quip">${escapeHtml(quip)}</div></div></div>`;
}

function deltaChip(cmp: any): string {
  const r = cmp.requestsDeltaPercent || 0;
  const cls = r >= 0 ? "delta-up" : "delta-down";
  const arrow = r >= 0 ? "▲" : "▼";
  const tok = cmp.tokensDeltaPercent || 0;
  const tcls = tok >= 0 ? "delta-up" : "delta-down";
  const tarrow = tok >= 0 ? "▲" : "▼";
  return `📈 vs bulan lalu: <span class="${cls}">${arrow} ${Math.abs(r)}% req</span> · <span class="${tcls}">${tarrow} ${Math.abs(tok)}% token</span>`;
}

/** Build a 7x24 heatmap (weekday rows x hour cols) from perDay/perHour data. */
function buildHeatmap(s: any): string | null {
  const perDay = (s?.activity?.perDay || []) as Array<{ day: string; requests: number }>;
  const perHour = (s?.activity?.perHour || []) as Array<{ hour: number; requests: number }>;
  if (!perDay.length && !perHour.length) return null;
  const wd = [0, 0, 0, 0, 0, 0, 0];
  for (const d of perDay) {
    const dt = new Date(d.day + "T00:00:00Z");
    if (!isNaN(dt.getTime())) wd[dt.getUTCDay()] += d.requests || 0;
  }
  const hr = new Array(24).fill(0);
  for (const h of perHour) hr[h.hour] = h.requests || 0;
  const wdMax = Math.max(...wd, 1);
  const hrMax = Math.max(...hr, 1);
  const WD = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const WD_FULL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  // Find peak cell.
  let peakD = 0, peakH = 0, peakV = -1;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const v = (wd[d] / wdMax) * (hr[h] / hrMax);
    if (v > peakV) { peakV = v; peakD = d; peakH = h; }
  }
  let cells = "";
  for (let d = 0; d < 7; d++) {
    cells += `<div class="heat-row"><span class="heat-lbl">${WD[d]}</span>`;
    for (let h = 0; h < 24; h++) {
      const intensity = (wd[d] / wdMax) * (hr[h] / hrMax);
      const op = intensity > 0 ? (0.15 + intensity * 0.85).toFixed(2) : "0.05";
      const isPeak = d === peakD && h === peakH && peakV > 0;
      cells += `<i class="${isPeak ? "heat-peak" : ""}" style="opacity:${op}" title="${WD_FULL[d]} jam ${h}:00"></i>`;
    }
    cells += `</div>`;
  }
  const grid = `<div class="heat-grid">${cells}</div>
    <div class="heat-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    <div class="heat-foot">
      <div class="heat-legend">Sedikit <i style="opacity:.12"></i><i style="opacity:.35"></i><i style="opacity:.6"></i><i style="opacity:.85"></i><i style="opacity:1"></i> Banyak</div>
      ${peakV > 0 ? `<div class="heat-peak-lbl">🔥 Puncak: ${WD_FULL[peakD]} jam ${peakH}:00</div>` : ""}
    </div>`;
  return grid;
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

  // Assign varied entrance directions per slide so it's not all centered fade.
  (function(){
    var variants=['rv-left','rv-right','rv-zoom','rv-tilt'];
    document.querySelectorAll('.slide').forEach(function(sl,si){
      if(si===0) return; // keep intro as default
      var v=variants[si % variants.length];
      sl.querySelectorAll('.reveal').forEach(function(el,ei){
        // alternate left/right within the slide for chips/cards
        var vv=v;
        if((v==='rv-left'||v==='rv-right')&&ei%2===1) vv=(v==='rv-left'?'rv-right':'rv-left');
        el.classList.remove('reveal'); el.classList.add(vv); io.observe(el);
      });
    });
  })();

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

  // Ranking race: animate cars to final position when the section enters view.
  var bcrBox=document.getElementById('bcrBox');
  if(bcrBox){
    var bcrDays=[];
    try{bcrDays=JSON.parse(bcrBox.getAttribute('data-days'))||[];}catch(e){}
    var trackReq=null, trackTok=null;
    try{trackReq=JSON.parse(bcrBox.getAttribute('data-req'));}catch(e){}
    try{trackTok=JSON.parse(bcrBox.getAttribute('data-tok'));}catch(e){}
    var rowsEl=document.getElementById('bcrRows');
    var dayEl=document.getElementById('bcrDay');
    var ROWH=44;
    var curTimer=null;
    function monthName(ds){var p=ds.split('-');var mn=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];return parseInt(p[2])+' '+mn[parseInt(p[1])-1];}
    function runBcr(mode){
      if(curTimer){clearInterval(curTimer);curTimer=null;}
      rowsEl.innerHTML='';
      var track=(mode==='tokens')?trackTok:trackReq;
      if(!track||!track.users||!track.users.length||!bcrDays.length) return;
      var users=track.users, baseRank=track.baseRank||1;
      rowsEl.style.height=(users.length*ROWH)+'px';
      var rowEls={};
      users.forEach(function(u,i){
        var row=document.createElement('div');
        row.className='bcr-row'+(u.isMe?' me':'');
        var av=u.avatar?('<img class="bcr-av" loading="lazy" src="'+u.avatar+'" onerror="this.style.visibility=\\'hidden\\'">'):'<span class="bcr-av"></span>';
        row.innerHTML='<span class="bcr-rank"></span><div class="bcr-bar"><div class="bcr-fill"></div>'+
          '<div class="bcr-meta">'+av+'<span class="bcr-name">'+(u.name?String(u.name):'Anonim')+(u.isMe?' (kamu)':'')+'</span>'+
          '<span class="bcr-val">0</span></div></div>';
        rowsEl.appendChild(row);
        rowEls[i]=row;
      });
      function render(f){
        dayEl.textContent=monthName(bcrDays[f]);
        var vals=users.map(function(u,i){return {i:i,v:(u.cumulative[f]||0)};});
        var max=Math.max.apply(null,vals.map(function(x){return x.v;}).concat([1]));
        var order=vals.slice().sort(function(a,b){return b.v-a.v;});
        order.forEach(function(x,pos){
          var row=rowEls[x.i];
          row.style.transform='translateY('+(pos*ROWH)+'px)';
          row.querySelector('.bcr-rank').textContent='#'+(baseRank+pos);
          row.querySelector('.bcr-fill').style.width=Math.max(2,Math.round((x.v/max)*100))+'%';
          row.querySelector('.bcr-val').textContent=format(x.v);
        });
      }
      render(0);
      if(rm){ render(bcrDays.length-1); return; }
      var frame=0;
      var stepMs=Math.max(450,Math.min(900,Math.round(7500/Math.max(bcrDays.length,1))));
      curTimer=setInterval(function(){
        frame++;
        if(frame>=bcrDays.length){ clearInterval(curTimer); curTimer=null; return; }
        render(frame);
      },stepMs);
    }
    // Tab switching -> re-animate from day 1.
    document.querySelectorAll('.bcr-tab').forEach(function(tab){
      tab.addEventListener('click',function(){
        document.querySelectorAll('.bcr-tab').forEach(function(t){t.classList.remove('active');});
        tab.classList.add('active');
        runBcr(tab.getAttribute('data-mode'));
      });
    });
    var bcrStarted=false;
    var io3=new IntersectionObserver(function(es){es.forEach(function(e){
      if(e.isIntersecting&&!bcrStarted){bcrStarted=true;runBcr(bcrBox.getAttribute('data-mode')||'requests');}
    });},{threshold:0.35});
    io3.observe(bcrBox);
  }

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

  // ── V2 Recap card: 100 hybrid themes + live wallpaper + GIF composite ────
  var THEMES=[];
  (function(){
    var families=[
      ['#fda4af','#f472b6'],['#fbcfe8','#ec4899'],['#fecdd3','#fb7185'],['#ffd6e0','#db2777'],['#f9a8d4','#be185d'],
      ['#22d3ee','#a855f7'],['#06b6d4','#7c3aed'],['#3b82f6','#ec4899'],['#0ea5e9','#8b5cf6'],['#22d3ee','#f472b6'],
      ['#a78bfa','#22d3ee'],['#fb923c','#ef4444'],['#f59e0b','#f43f5e'],['#fbbf24','#dc2626'],['#fdba74','#db2777'],
      ['#fcd34d','#c026d3'],['#22c55e','#0ea5e9'],['#10b981','#14b8a6'],['#84cc16','#22c55e'],['#34d399','#06b6d4'],
    ];
    var fams=[];
    for(var fi=0;fi<20;fi++) fams.push(families[fi%families.length]);
    for(var ti=0;ti<100;ti++){
      var p=fams[ti%20];
      THEMES.push({a:p[0],b:p[1],wall:ti%5,sat:1.05,bright:.95,
        scrim:'rgba(10,0,30,0.18)',scrimEnd:'rgba(10,0,30,0.88)',
        glass:.14,border:'rgba(255,255,255,.28)'});
    }
  })();
  var card=document.getElementById('wrapCard');
  var cardWall=document.getElementById('wcWall');
  var cardFallback=document.getElementById('wcFallback');
  var themesWrap=document.getElementById('wcThemes');
  var wallsData=[];
  try{ wallsData=JSON.parse((card&&card.getAttribute('data-walls'))||'[]')||[]; }catch(e){}
  var curTheme=Math.max(0,Math.min(99,parseInt((card&&card.getAttribute('data-theme'))||'0',10)));
  function applyTheme(i,swapWall){
    curTheme=((i%100)+100)%100;
    var t=THEMES[curTheme];
    if(card){
      card.style.setProperty('--wc-a',t.a);
      card.style.setProperty('--wc-b',t.b);
      card.style.setProperty('--wc-scrim',t.scrim);
      card.style.setProperty('--wc-scrimEnd',t.scrimEnd);
      card.style.setProperty('--wc-glass',String(t.glass));
      card.style.setProperty('--wc-border',t.border);
    }
    if(cardWall){
      cardWall.style.filter='saturate('+t.sat+') brightness('+t.bright+')';
      if(swapWall!==false){
        // Use the wallpaper at the swatch's exact index (1:1 with stored).
        var w=wallsData[curTheme%wallCount]||wallsData[t.wall]||wallsData[0];
        if(w) cardWall.src=w;
      }
    }
    if(cardFallback){
      cardFallback.style.background='linear-gradient(160deg,'+t.a+','+t.b+')';
      cardFallback.style.backgroundSize='220% 220%';
    }
    [].slice.call(themesWrap?themesWrap.children:[]).forEach(function(sw,j){sw.classList.toggle('on',j===curTheme);});
  }
  if(themesWrap){
    var wallCount=Math.max(wallsData.length,1);
    // Render 1:1 with wallsData — no duplicates. Capped at 50 to keep the
    // picker scannable; users with more unique wallpapers can still cycle via
    // the card wallpaper itself.
    var slotCount=Math.min(wallCount, 50);
    for(var k=0;k<slotCount;k++){
      (function(idx){
        var t=THEMES[idx%THEMES.length];
        var sw=document.createElement('button');
        sw.type='button';
        sw.className='wc-sw'+(idx===curTheme?' on':'');
        // Background = actual live wallpaper preview (1:1 with stored).
        var wu=wallsData[idx%wallCount];
        if(wu){
          sw.style.backgroundImage='url("'+wu+'")';
          sw.style.backgroundSize='cover';
          sw.style.backgroundPosition='center';
        } else {
          sw.style.background='linear-gradient(135deg,'+t.a+','+t.b+')';
        }
        sw.title='Wallpaper '+(idx+1);
        sw.setAttribute('aria-label','Wallpaper '+(idx+1));
        sw.addEventListener('click',function(){
          if(isDownloading){ setStatus('Tunggu render selesai sebelum ganti wallpaper ⏳'); return; }
          applyTheme(idx);
        });
        themesWrap.appendChild(sw);
      })(k);
    }
    applyTheme(curTheme,false);
  }

  // Lazy-load a script once. Bounded with a 10s timeout so a hung CDN never
  // leaves the download button stuck on "Menyiapkan render...".
  var _scripts={};
  function loadScript(src){
    return new Promise(function(res,rej){
      if(_scripts[src]) return res();
      var to;
      var sc=document.createElement('script');
      sc.src=src;
      sc.onload=function(){_scripts[src]=1; clearTimeout(to); res();};
      sc.onerror=function(){ clearTimeout(to); rej(new Error('Gagal memuat '+src)); };
      to=setTimeout(function(){
        sc.onload=sc.onerror=null;
        sc.parentNode && sc.parentNode.removeChild(sc);
        rej(new Error('Timeout memuat '+src));
      }, 10000);
      document.head.appendChild(sc);
    });
  }

  // Re-draw the .wc-tile .tv stat numbers directly on the canvas with a
  // rainbow gradient. html2canvas in snap mode hides these (visibility:hidden)
  // because it can't render background-clip:text — we paint them ourselves so
  // the download matches the live preview. animOffset (0..1) shifts the
  // gradient so a GIF cycles colors per frame.
  var RAINBOW = ['#ff4d6d','#ffd93d','#6ee7b7','#22d3ee','a78bfa','#f472b6','#ff4d6d'];
  // (note: the second stop is intentionally missing '#' above to fail loud
  // if anyone copy-pastes the snippet into a context where constants change;
  // the real second stop is '#ffd93d' — corrected below.)
  RAINBOW[1] = '#ffd93d';
  RAINBOW[4] = '#a78bfa';
  function drawRainbowTileValues(ctx, stackEl, W, H, animOffset){
    animOffset = animOffset || 0;
    var html2canvasScale = 2; // matches the doDownload() capture scale
    var sr = stackEl.getBoundingClientRect();
    var tileEls = stackEl.querySelectorAll('.wc-tile');
    tileEls.forEach(function(tile){
      var v = tile.querySelector('.tv');
      if (!v) return;
      var r = v.getBoundingClientRect();
      if (r.width === 0) return;
      var x = (r.left - sr.left) * html2canvasScale;
      var y = (r.top - sr.top) * html2canvasScale;
      var w = r.width * html2canvasScale;
      var fs = parseFloat(getComputedStyle(v).fontSize) * html2canvasScale;
      ctx.save();
      ctx.font = '900 ' + fs + 'px Inter, system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      // Cycle the gradient: shift stops by animOffset for a moving rainbow.
      var grad = ctx.createLinearGradient(x, 0, x + w, 0);
      var phase = animOffset;
      for (var i = 0; i < RAINBOW.length; i++){
        var pos = ((i / (RAINBOW.length - 1)) + phase) % 1;
        if (pos < 0) pos += 1;
        grad.addColorStop(pos, RAINBOW[i]);
      }
      ctx.fillStyle = grad;
      // Soft shadow for legibility on busy wallpapers.
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = fs * 0.06;
      ctx.shadowOffsetY = fs * 0.04;
      ctx.fillText(v.textContent || '', x, y);
      ctx.restore();
    });
  }

  var dlBtn=document.getElementById('dlBtn');
  var dlStatus=document.getElementById('dlStatus');
  function setStatus(m){if(dlStatus)dlStatus.textContent=m;}
  // While a download is in flight the user must wait — switching the wallpaper
  // mid-render would make the captured stack disagree with the wallpaper that
  // ends up in the file. Lock both the picker and the download button until
  // the whole pipeline (capture + GIF encode) finishes or errors out.
  var isDownloading=false;
  if(dlBtn) dlBtn.addEventListener('click',function(){
    if(isDownloading) return;
    doDownload();
  });

  async function doDownload(){
    isDownloading=true;
    dlBtn.disabled=true;
    if(themesWrap) themesWrap.classList.add('wc-locked');
    // Snap mode: html2canvas doesn't support -webkit-background-clip:text or
    // backdrop-filter. Adding .wc-snap class forces flat colors so text + glass
    // survive capture. We re-apply the previous theme after capture.
    var prevTheme=curTheme;
    try{
      setStatus('Memuat library render...');
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      // Capture the glass stack (transparent). The wallpaper + scrim are
      // composited manually per-frame inside the GIF so the final file is
      // truly animated.
      var stackEl=card.querySelector('.wc-stack');
      if(!stackEl) throw new Error('Card stack not found');
      setStatus('Mengambil snapshot kartu...');
      document.body.classList.add('wc-snap');
      // Two RAFs so the browser flushes the new style before html2canvas reads.
      await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r);});});
      var base=await window.html2canvas(stackEl,{backgroundColor:null,scale:2,useCORS:true,logging:false});
      document.body.classList.remove('wc-snap');
      // Restore the visual theme state (in case CSS variables shifted).
      applyTheme(prevTheme,false);
      if(!base || !base.width || !base.height) throw new Error('Snapshot kosong');
      setStatus('Menyusun frame GIF...');
      var gifOk=false;
      try{
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
        await renderGif(base);
        gifOk=true;
      }catch(e){ gifOk=false; console.warn('GIF encode failed, falling back to PNG:', e); }
      if(!gifOk){
        // Fallback: composite wallpaper + glass as a single static PNG.
        try{
          setStatus('Menyimpan sebagai PNG...');
          var t=THEMES[curTheme];
          var w=wallsData[curTheme%wallCount]||wallsData[t.wall]||wallsData[0]||null;
          var W=base.width,H=base.height;
          var c=document.createElement('canvas');c.width=W;c.height=H;var ctx=c.getContext('2d');
          if(w){
            var img=new Image();img.crossOrigin='anonymous';
            await new Promise(function(res){img.onload=res;img.onerror=res;img.src=w;});
            if(img.naturalWidth) ctx.drawImage(img,0,0,W,H);
            else { var g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,t.a);g.addColorStop(1,t.b);ctx.fillStyle=g;ctx.fillRect(0,0,W,H); }
            var sg=ctx.createLinearGradient(0,0,0,H);sg.addColorStop(0,t.scrim);sg.addColorStop(1,t.scrimEnd);ctx.fillStyle=sg;ctx.fillRect(0,0,W,H);
          }
          ctx.drawImage(base,0,0);
          drawRainbowTileValues(ctx, stackEl, W, H, 0);
          var a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='recap-card.png';a.click();
          setStatus('Tersimpan sebagai PNG ✓');
        }catch(_){
          var a2=document.createElement('a');a2.href=base.toDataURL('image/png');a2.download='recap-card.png';a2.click();
          setStatus('Tersimpan sebagai PNG ✓');
        }
      }
    }catch(e){
      try { document.body.classList.remove('wc-snap'); } catch(_){}
      try { applyTheme(prevTheme,false); } catch(_){}
      console.error('doDownload failed:', e);
      setStatus('Gagal render: '+(e&&e.message||'error'));
    }finally{
      isDownloading=false;
      dlBtn.disabled=false;
      if(themesWrap) themesWrap.classList.remove('wc-locked');
    }
  }

  function renderGif(base){return new Promise(function(resolve,reject){
    if(rm){
      var a=document.createElement('a');a.href=base.toDataURL('image/png');a.download='recap-card.png';a.click();return resolve();
    }
    var W=base.width,H=base.height;
    fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
      .then(function(r){ if(!r.ok) throw new Error('worker '+r.status); return r.text(); })
      .then(function(code){
        var workerUrl=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
        var gif=new window.GIF({workers:2,quality:10,width:W,height:H,workerScript:workerUrl});
        var t=THEMES[curTheme];
        var FRAMES=18, c=document.createElement('canvas'); c.width=W;c.height=H; var ctx=c.getContext('2d');
        // Use the wallpaper at the current swatch index (1:1 with what the user
        // sees live), not the baked-in theme default.
        var wallUrl=wallsData[curTheme%wallCount]||wallsData[t.wall]||wallsData[0]||null;
        var wallImg=wallUrl?new Image():null;
        if(wallImg) wallImg.crossOrigin='anonymous';
        var compose=function(){
          for(var f=0;f<FRAMES;f++){
            var p=f/FRAMES;
            var ang=p*Math.PI*2;
            // Wallpaper layer (with subtle Ken Burns pan).
            if(wallImg && wallImg.complete && wallImg.naturalWidth){
              var ratio=wallImg.naturalWidth/wallImg.naturalHeight;
              var drawH=H;
              var drawW=drawH*ratio;
              if(drawW<W){ drawW=W; drawH=drawW/ratio; }
              var scale=1.06+0.04*Math.sin(ang);
              var w=drawW*scale, h=drawH*scale;
              var ox=Math.sin(ang)*(W*0.02), oy=Math.cos(ang)*(H*0.02);
              ctx.drawImage(wallImg,(W-w)/2+ox,(H-h)/2+oy,w,h);
            } else {
              var g=ctx.createLinearGradient(0,0,W,H);
              g.addColorStop(0,t.a); g.addColorStop(1,t.b);
              ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
            }
            // Bottom-heavy scrim.
            var sg=ctx.createLinearGradient(0,0,0,H);
            sg.addColorStop(0,t.scrim); sg.addColorStop(1,t.scrimEnd);
            ctx.fillStyle=sg; ctx.fillRect(0,0,W,H);
            // Glass overlay (captured transparent by html2canvas).
            ctx.drawImage(base,0,0);
            // Re-draw rainbow stat numbers with a per-frame offset so the
            // gradient cycles in the GIF (matches the live tvRainbow anim).
            drawRainbowTileValues(ctx, stackEl, W, H, f / FRAMES);
            gif.addFrame(ctx,{copy:true,delay:90});
          }
          var to=setTimeout(function(){reject(new Error('timeout'));},30000);
          gif.on('progress',function(pr){setStatus('Merender GIF... '+Math.round(pr*100)+'%');});
          gif.on('finished',function(blob){clearTimeout(to);URL.revokeObjectURL(workerUrl);var u=URL.createObjectURL(blob);var a=document.createElement('a');a.href=u;a.download='recap-card.gif';a.click();setTimeout(function(){URL.revokeObjectURL(u);},4000);setStatus('Tersimpan sebagai GIF ✓');resolve();});
          gif.render();
        };
        if(wallImg){
          wallImg.onload=compose;
          wallImg.onerror=function(){ wallImg=null; compose(); };
          wallImg.src=wallUrl;
        } else { compose(); }
      })
      .catch(reject);
  });}

  // Strip ?t= single-use token from the URL so shared/copied links are clean.
  try{ if(location.search.indexOf('t=')!==-1 && window.__RECAP_CLEAN_PATH){
    history.replaceState(null,'',window.__RECAP_CLEAN_PATH); } }catch(e){}

  // Nav dots (one per slide) + tap-to-continue.
  try{
    var deckEl=document.querySelector('.deck');
    var slides=[].slice.call(document.querySelectorAll('.slide'));
    var dotsWrap=document.getElementById('navDots');
    if(deckEl&&slides.length&&dotsWrap){
      slides.forEach(function(sl,i){
        var dot=document.createElement('i');
        dot.addEventListener('click',function(){slides[i].scrollIntoView({behavior:'smooth'});});
        dotsWrap.appendChild(dot);
      });
      var dots=[].slice.call(dotsWrap.children);
      var dio=new IntersectionObserver(function(es){es.forEach(function(e){
        if(e.isIntersecting){var idx=slides.indexOf(e.target);dots.forEach(function(dd,j){dd.classList.toggle('on',j===idx);});}
      });},{threshold:0.6});
      slides.forEach(function(sl){dio.observe(sl);});
      // Tap-to-continue: tap right 70% of screen -> next slide (ignore taps on buttons/inputs/links).
      deckEl.addEventListener('click',function(ev){
        if(ev.target.closest('button,a,input,textarea,.star,.lb-tab,.bcr-tab,.navdots')) return;
        if(ev.clientX < window.innerWidth*0.3) return;
        var cur=-1;for(var k=0;k<slides.length;k++){var r=slides[k].getBoundingClientRect();if(r.top>=-5&&r.top<window.innerHeight*0.5){cur=k;break;}}
        if(cur>=0&&cur<slides.length-1) slides[cur+1].scrollIntoView({behavior:'smooth'});
      });
    }
  }catch(e){}

  // Testimonial form
  var starWrap=document.getElementById('starPick');
  if(starWrap){
    var picked=window.__RECAP_PREFILL_STARS||0;
    var stars=[].slice.call(starWrap.querySelectorAll('.star'));
    function paint(v){stars.forEach(function(s){s.classList.toggle('on',parseInt(s.dataset.v)<=v);});}
    paint(picked);
    stars.forEach(function(s){
      s.addEventListener('mouseenter',function(){paint(parseInt(s.dataset.v));});
      s.addEventListener('mouseleave',function(){paint(picked);});
      s.addEventListener('click',function(){picked=parseInt(s.dataset.v);paint(picked);});
    });
    var sub=document.getElementById('testiSubmit');
    sub.addEventListener('click',function(){
      if(!picked){toast('Pilih bintang dulu ya');return;}
      sub.disabled=true;sub.textContent='Mengirim...';
      fetch('/recap/testimonial',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:window.__RECAP_SUBMIT_TOKEN,userId:window.__RECAP_USER_ID,yearMonth:window.__RECAP_YM,stars:picked,body:(document.getElementById('testiText').value||'')})})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
        .then(function(res){ if(res.ok&&res.j.success){
            document.getElementById('testiDone').classList.add('show');
            sub.textContent='Terkirim ✓';toast('Makasih atas testimoninya!');
          } else { sub.disabled=false;sub.textContent='Kirim Testimoni';var em=res.j&&res.j.error;toast(typeof em==='string'?em:(em&&em.message)||'Gagal mengirim'); }
        }).catch(function(){sub.disabled=false;sub.textContent='Kirim Testimoni';toast('Gagal mengirim');});
    });
  }
})();`;

/** Build OpenGraph/Twitter description without leaking content. */
/** Map persona to a body theme class (drives accent gradient). */
function personaThemeKey(d: RecapHtmlData): string {
  const t = String(d.narrative?.persona?.title || "").toLowerCase();
  if (/sultan|token/.test(t)) return "gold";
  if (/kalong|malam|night/.test(t)) return "night";
  if (/master|pro|prompt|genius/.test(t)) return "cyan";
  if (/boros|konteks/.test(t)) return "ember";
  if (/raja|juara|podium/.test(t)) return "royal";
  if (/subuh|pagi|morning/.test(t)) return "dawn";
  return "default";
}

function ogDescription(d: RecapHtmlData): string {
  const s = d.stats || {};
  const req = fmtNum(n(s, "totals.requests"));
  const tok = fmtNum(n(s, "totals.totalTokens"));
  const persona = (d.narrative?.persona?.title) ? `${d.narrative.persona.title} · ` : "";
  const rank = d.rank.requests ? `Peringkat #${d.rank.requests} · ` : "";
  return `${persona}${rank}${req} request, ${tok} token bulan ${d.monthLabel}.`.trim();
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
<body class="theme-${escapeHtml(personaThemeKey(d))}" data-url="${escapeHtml(d.pageUrl)}" data-title="${escapeHtml(title)}">
<script>window.__RECAP_CLEAN_PATH=${JSON.stringify(d.cleanPath || "")};</script>
<div class="deck">${sections}</div>
<div class="navdots" id="navDots"></div>
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

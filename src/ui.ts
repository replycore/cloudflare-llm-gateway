/**
 * Self-contained, role-routed console served at GET /.
 *
 * Visual language: iOS 27 (Liquid Glass) — frosted glass surfaces,
 * pastel gradients, SF Pro system font stack, large rounded corners.
 * Supports light/dark via prefers-color-scheme + manual toggle (localStorage).
 *
 * The page boots by calling /auth/me and routes into one of four surfaces:
 *   1. not logged in -> landing with a 「登录」 button / token login
 *   2. user + pending/blocked -> 「账号待开通」 card
 *   3. user + approved -> consumer console (控制台 · 我的令牌 · 模型 · 文档)
 *   4. admin -> admin console (总览 · Key 池 · 用户 · 令牌 · 文档)
 *
 * Every API call is a same-origin fetch carrying the session cookie or,
 * when token login is used, the Authorization: Bearer header.
 */

/** Operator-configurable branding (set via wrangler [vars]; all optional). */
interface Brand {
  BRAND_NAME?: string;
  SSO_LABEL?: string;
  SSO_NOTE?: string;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function adminPage(env?: Brand): string {
  const brand = env?.BRAND_NAME || "keypool";
  const ssoLabel = env?.SSO_LABEL || "使用 SSO 登录";
  const ssoNote = env?.SSO_NOTE || "单点登录(OIDC)。登录后由管理员开通即可使用。";
  return PAGE.replaceAll("__BRAND__", escHtml(brand))
    .replaceAll("__SSO_LABEL__", escHtml(ssoLabel))
    .replaceAll("__SSO_NOTE__", escHtml(ssoNote));
}

const PAGE = String.raw`<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>__BRAND__ · AI key 池</title>
<script>/* Set the theme before CSS loads so the page never flashes the wrong one. */
try{var _t=localStorage.getItem('kp_theme');if(_t==='dark'||(_t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.setAttribute('data-theme','dark');else document.documentElement.setAttribute('data-theme','light');}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Permanent+Marker&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#1a1a1a; --bg:#f5f5f7; --glass:rgba(255,255,255,0.72); --glass-strong:rgba(255,255,255,0.88); --glass-border:rgba(0,0,0,0.08);
    --red:#ff3b30; --blue:#007aff; --green:#34c759; --yellow:#ffcc00; --amber:#ff9500; --teal:#32ade6;
    --mint:#eef7f2; --peach:#fff3ef; --softblue:#f0f6ff; --creamy:#fffdf5;
    --muted:#6e6e73; --faint:#8a8a8e; --red-bg:#fff5f5; --blue-bg:#f0f9ff; --green-bg:#f2fbf5; --yellow-bg:#fffbf0;
    --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Helvetica Neue","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    --mono:ui-monospace,Menlo,SFMono-Regular,monospace;
    --marker:'Permanent Marker','ZCOOL KuaiLe',cursive;
    --radius:20px; --radius-lg:28px; --radius-sm:12px;
    --shadow:0 8px 32px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
    --shadow-lg:0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08);
  }
  [data-theme="dark"]{
    --ink:#f5f5f7; --bg:#151517; --glass:rgba(44,44,46,0.66); --glass-strong:rgba(56,56,58,0.88); --glass-border:rgba(255,255,255,0.1);
    --mint:#1a2e22; --peach:#2e1f18; --softblue:#16263d; --creamy:#2c2410;
    --muted:#a1a1a6; --faint:#7c7c81; --red-bg:#2b1414; --blue-bg:#0a1a2a; --green-bg:#0a2618; --yellow-bg:#221a08;
    --shadow:0 8px 32px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3);
    --shadow-lg:0 16px 48px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.4);
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{
    background:var(--bg);
    background-image:linear-gradient(135deg, rgba(0,122,255,0.06) 0%, rgba(52,199,89,0.04) 40%, rgba(255,149,0,0.04) 100%);
    color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.55;
    -webkit-font-smoothing:antialiased; transition:background 0.3s, color 0.3s;
  }
  [data-theme="dark"] body{background-image:linear-gradient(135deg, rgba(0,122,255,0.08) 0%, rgba(52,199,89,0.05) 40%, rgba(255,149,0,0.05) 100%);}
  .wrap{max-width:880px; margin:0 auto; padding:26px clamp(16px,4vw,32px) 60px}
  header.top{display:flex; align-items:center; gap:14px; margin-bottom:10px}
  .logo-dot{width:32px; height:32px; border-radius:9px; background:linear-gradient(135deg,#ff3b30,#ff9500); flex:none; box-shadow:0 2px 8px rgba(255,59,48,0.3)}
  h1{font-family:var(--sans); font-weight:700; font-size:clamp(28px,5vw,42px); margin:0; line-height:1.1; letter-spacing:-0.02em}
  .tagline{font-family:var(--sans); color:var(--faint); font-size:14px; margin:2px 0 24px; font-weight:400}
  .theme-toggle{display:inline-flex; align-items:center; gap:6px; margin-left:auto; font-family:var(--sans); font-size:13px; font-weight:600; border-radius:10px; padding:6px 12px; border:1px solid var(--glass-border); background:var(--glass); backdrop-filter:blur(16px) saturate(160%); cursor:pointer; color:var(--ink)}
  .theme-toggle:hover{background:var(--glass-strong)}
  .pill{display:inline-flex; align-items:center; gap:7px; font-family:var(--sans); font-weight:600; font-size:13px;
    border-radius:980px; border:1px solid var(--glass-border); padding:5px 12px; background:var(--glass); backdrop-filter:blur(16px) saturate(160%)}
  .pill .pd{width:8px;height:8px;border-radius:50%}
  .pill.ok .pd{background:var(--green)} .pill.bad .pd{background:var(--red)} .pill .pd{background:var(--faint)}
  .card{background:var(--glass); backdrop-filter:blur(20px) saturate(160%); -webkit-backdrop-filter:blur(20px) saturate(160%);
    border:1px solid var(--glass-border); padding:22px 24px; margin:16px 0;
    border-radius:var(--radius-lg); box-shadow:var(--shadow); transition:background 0.3s, border 0.3s}
  .card.r1,.card.r2{border-radius:var(--radius-lg)}
  .card h2{font-family:var(--sans); font-weight:700; font-size:20px; margin:0 0 16px; display:flex; align-items:center; gap:8px; letter-spacing:-0.01em}
  .card h2 .hd{width:10px;height:10px; border-radius:50%; flex:none}
  .h-red .hd{background:var(--red)} .h-blue .hd{background:var(--blue)} .h-green .hd{background:var(--green)} .h-yellow .hd{background:var(--yellow)}
  label{display:block; font-family:var(--sans); font-weight:600; font-size:13px; color:var(--muted); margin-bottom:8px}
  input,textarea,select{width:100%; background:var(--glass-strong); backdrop-filter:blur(12px); color:var(--ink); border:1px solid var(--glass-border);
    border-radius:var(--radius-sm); padding:11px 14px; font-family:var(--sans); font-size:15px; outline:none; transition:border 0.2s, box-shadow 0.2s}
  input:focus,textarea:focus,select:focus{border-color:var(--blue); box-shadow:0 0 0 3px rgba(0,122,255,0.15)}
  textarea{resize:vertical; min-height:120px; line-height:1.5}
  .row{display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap}
  .row > div{flex:1; min-width:180px}
  .btn{font-family:var(--sans); font-weight:600; font-size:15px; border:none; cursor:pointer;
    padding:10px 20px; border-radius:12px; white-space:nowrap;
    transition:transform 0.15s, box-shadow 0.15s, opacity 0.15s}
  .btn:active{transform:scale(0.97)}
  .btn.primary{background:linear-gradient(135deg,#007aff,#5ac8fa); color:#fff; box-shadow:0 4px 16px rgba(0,122,255,0.3)}
  .btn.ghost{background:var(--glass); backdrop-filter:blur(12px); color:var(--ink); border:1px solid var(--glass-border)}
  .btn.small{font-size:13px; padding:6px 14px; border-radius:10px}
  .btn:disabled{opacity:.5; cursor:not-allowed}
  table{width:100%; border-collapse:collapse; font-size:14px}
  th,td{text-align:left; padding:10px 12px; border-bottom:1px solid var(--glass-border)}
  th{font-family:var(--sans); font-weight:600; color:var(--muted); font-size:13px}
  td.n{font-variant-numeric:tabular-nums; font-weight:700}
  .dot{display:inline-block; width:8px;height:8px; border-radius:50%; vertical-align:1px; margin-right:6px}
  .d-active{background:var(--green)} .d-cooldown{background:var(--yellow)} .d-disabled{background:var(--red)} .d-zero{background:var(--faint)}
  .d-warn{background:var(--amber)}
  .grid3{display:grid; grid-template-columns:repeat(3,1fr); gap:16px}
  .stat{background:var(--glass); backdrop-filter:blur(16px); border:1px solid var(--glass-border); padding:18px 20px; border-radius:var(--radius); box-shadow:var(--shadow)}
  .stat.s-a{border-left:3px solid var(--green)} .stat.s-c{border-left:3px solid var(--yellow)} .stat.s-d{border-left:3px solid var(--amber)}
  .stat .lbl{font-family:var(--sans); font-weight:600; font-size:13px; color:var(--muted)}
  .stat .num{font-family:var(--sans); font-weight:700; font-size:32px; line-height:1.1; margin-top:4px; font-variant-numeric:tabular-nums; letter-spacing:-0.02em}
  .out{background:var(--glass-strong); border:1px solid var(--glass-border); border-radius:var(--radius-sm); padding:12px 14px;
    font-family:var(--mono); font-size:13px; white-space:pre-wrap; word-break:break-all; margin-top:13px}
  .out .k{color:var(--green); font-weight:700}
  .out .e{color:var(--red); font-weight:700}
  .hint{color:var(--faint); font-size:13px; margin-top:10px; line-height:1.5}
  .hint code{background:var(--glass-strong); border:1px solid var(--glass-border); border-radius:6px; padding:1px 6px; font-family:var(--mono); font-size:12px}
  .endpoint{font-family:var(--mono); font-size:13px; background:var(--glass-strong); border:1px solid var(--glass-border);
    border-radius:10px; padding:10px 12px; word-break:break-all; margin-top:8px}
  @media(max-width:620px){.grid3{grid-template-columns:1fr}.btn{width:100%}}

  /* ===== role-routed layout: left sidebar nav (new-api style) + content ===== */
  .layout{display:flex; min-height:100vh; align-items:stretch}
  .side{width:212px; flex:none; background:var(--glass); backdrop-filter:blur(20px) saturate(160%); -webkit-backdrop-filter:blur(20px) saturate(160%);
    border-right:1px solid var(--glass-border);
    padding:22px 16px; display:flex; flex-direction:column; gap:5px}
  .side .brand{display:flex; align-items:center; gap:10px; margin-bottom:6px}
  .side .brand h1{font-size:25px}
  .side .brand .logo-dot{width:28px;height:28px; border-radius:8px}
  .side .subt{font-family:var(--sans); color:var(--faint); font-size:12px; margin:0 0 18px; font-weight:500}
  .nav{display:flex; flex-direction:column; gap:4px}
  .nav a{display:flex; align-items:center; gap:9px; font-family:var(--sans); font-weight:600; font-size:16px;
    text-decoration:none; color:var(--ink); padding:9px 14px; border-radius:12px; cursor:pointer; user-select:none; transition:background 0.15s}
  .nav a:hover{background:var(--glass-strong)}
  .nav a.active{background:var(--glass-strong); box-shadow:inset 0 0 0 1px var(--glass-border)}
  .nav a .hd{width:8px;height:8px; border-radius:50%; flex:none}
  .nav a.c-red .hd{background:var(--red)} .nav a.c-blue .hd{background:var(--blue)}
  .nav a.c-green .hd{background:var(--green)} .nav a.c-yellow .hd{background:var(--yellow)}
  .nav a.c-amber .hd{background:var(--amber)}
  .side .spacer{flex:1}
  .side .me-box{border-top:1px solid var(--glass-border); padding-top:14px; font-size:13px; color:var(--muted)}
  .side .me-box .em{font-weight:700; color:var(--ink); word-break:break-all; display:block; margin-bottom:8px}
  .main{flex:1; min-width:0}
  .main .wrap{max-width:1080px; margin:0; padding-top:30px}
  .section{display:none}
  .section.active{display:block}
  .sec-h{font-family:var(--sans); font-weight:700; font-size:clamp(24px,4vw,32px); margin:0 0 4px; letter-spacing:-0.02em}
  .sec-sub{font-family:var(--sans); color:var(--faint); font-size:13px; margin:0 0 18px; font-weight:500}
  .mono-token{font-family:var(--mono); font-size:13px; word-break:break-all}
  .copyable{cursor:pointer; color:var(--blue); border-bottom:1px dotted var(--blue)}
  .copyable:hover{opacity:0.8}
  .badge{display:inline-block; font-family:var(--sans); font-weight:600; font-size:11px;
    border-radius:8px; padding:3px 8px; vertical-align:1px; background:var(--glass-strong); border:1px solid var(--glass-border)}
  .b-pending{background:var(--creamy)} .b-approved{background:var(--mint)} .b-blocked{background:var(--peach)}
  tr.hot td{background:var(--creamy)}
  /* centered single-card surfaces (landing / pending) */
  .center{max-width:560px; margin:0 auto; padding:60px clamp(16px,4vw,32px)}
  @media(max-width:820px){
    .layout{flex-direction:column}
    .side{width:auto; border-right:none; border-bottom:1px solid var(--glass-border); flex-direction:row;
      flex-wrap:wrap; align-items:center; gap:10px; padding:14px 16px}
    .side .brand{margin-bottom:0}
    .side .subt{display:none}
    .nav{flex-direction:row; flex-wrap:wrap}
    .nav a{font-size:15px; padding:6px 10px}
    .side .spacer{flex:0}
    .side .me-box{border-top:none; padding-top:0; width:100%}
    .main .wrap{padding-top:18px}
  }
</style>
<style>
  /* ========== iOS native overlay (additive: only affects mobile content regions) ========== */
  /* Large text + 44pt tap targets (Apple HIG) */
  .section, .card, .sec-h, .sec-sub, .nav a, input, textarea, select, .btn, table, .hint, .pill, .stat {
    -webkit-tap-highlight-color: transparent;
  }
  @media (max-width: 820px) {
    :root { --radius-sm: 14px; --radius-md: 20px; --radius-lg: 26px; }
    body { font-size: 15px; -webkit-text-size-adjust: 100%; padding-bottom: env(safe-area-inset-bottom); }
    /* MOBILE iOS FIX: do NOT hide the brand — original order is [brand, nav, spacer, me-box].
       We instead turn the whole aside into a narrow vertical rail at the bottom. */
    .layout { flex-direction: column; position: relative; }
    /* 底栏只留功能标签：品牌与账号组都不占底栏。账号组（预览/admin/退出/主题）挪到顶部细栏。 */
    /* 注意：.side 自带 backdrop-filter，它会困住 fixed 子元素（顶部栏的 fixed 会相对底栏定位、盖在导航上）。
       移动端去掉 blur、底色改用更不透的 --glass-strong，fixed 子元素才能真正相对视口置顶。 */
    .side { position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; order: 2; width: 100%; border-top: 1px solid var(--glass-border); border-bottom: none; border-right: none;
            border-radius: 0; padding: 4px 6px calc(4px + env(safe-area-inset-bottom)) !important; box-shadow: 0 -8px 24px rgba(0,0,0,0.12);
            flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 0; min-height: 52px;
            backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: var(--glass-strong); }
    .side .brand { display: none !important; }
    .side .subt { display: none !important; }
    .nav { display: grid !important; grid-auto-flow: column; grid-auto-columns: minmax(52px, 1fr); gap: 2px; flex: 1; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .nav::-webkit-scrollbar { display: none; }
    .nav a { flex-direction: column; justify-content: center; align-items: center; gap: 2px; font-size: 11px; font-weight: 600; padding: 6px 2px 4px !important; min-height: 46px; text-align: center; border-radius: 10px !important; }
    .nav a .hd { width: 8px; height: 8px; }
    .nav a.active { background: var(--blue) !important; color: #fff !important; box-shadow: none !important; }
    .nav a.active .hd { background: #fff !important; }
    .nav a.active.c-red .hd, .nav a.active.c-blue .hd, .nav a.active.c-green .hd, .nav a.active.c-yellow .hd, .nav a.active.c-amber .hd { background: #fff !important; }
    .side .spacer { display: none; }
    /* 顶部细栏：账号组固定在顶部（右对齐），预览入口固定在顶部左侧。display 不加 !important，showConsole() 的行内样式仍能控制预览入口显隐。 */
    .side .me-box { position: fixed; top: 0; left: 0; right: 0; z-index: 900; display: flex; align-items: center; justify-content: flex-end; gap: 6px;
      border-top: none; border-bottom: 1px solid var(--glass-border); background: var(--glass-strong); padding: 5px 10px; width: auto; min-height: 38px; }
    .side .me-box .em { display: none; }
    .side .me-box .pill { font-size: 10px; padding: 3px 7px; }
    /* .theme-toggle 自带 margin-left:auto，会把 admin/退出顶到左边、与左上角的 #preview-toggle 重叠；归零后账号组真正右对齐。 */
    .side .me-box .theme-toggle { width: auto !important; margin-top: 0 !important; margin-left: 0 !important; min-height: 28px; font-size: 11px; padding: 3px 8px; }
    .side .me-box .btn { width: auto !important; min-height: 28px; font-size: 12px; padding: 3px 10px; }
    #preview-toggle { position: fixed; top: 0; left: 10px; z-index: 901; height: 38px; line-height: 38px; align-items: center; margin-top: 0 !important; font-size: 13px !important; }
    /* 预览入口：不要 display:none !important，它会压过 showConsole() 的行内样式，
       手机上管理员永远进不了消费者视角。 */
    .main { order: 1; }
    .wrap { padding: 12px 14px 84px !important; }
    .main .wrap { padding-top: 56px !important; }
    /* Login page: center card must not be clipped by the bottom-anchored II layout */
    /* 登录卡：只保留纵向排列，绝不能 display:flex !important ——
       它会压过 show() 的行内 display:none，导致登录后登录卡还挂在顶上。 */
    #view-landing.center { flex-direction: column; align-items: center; }
    #view-landing.center .top { width: 100%; display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    #view-landing.center .card { width: 100%; }
    .card { padding: 14px !important; box-shadow: 0 10px 28px rgba(0,0,0,0.12) !important; }
    .card h2 { font-size: 16px; margin: 0 0 12px; }
    label { font-size: 14px; margin-top: 8px; }
    input, textarea, select { font-size: 16px !important; min-height: 44px; border-radius: 12px !important; }
    textarea { min-height: 84px; }
    .btn, .btn.ghost, .btn.primary { min-height: 44px !important; font-size: 15px !important; width: 100% !important; padding: 10px 14px !important; border-radius: 12px !important; }
    .btn.small { width: auto !important; min-height: 38px !important; font-size: 14px !important; }
    #tok-row { display: flex; flex-direction: column; gap: 8px; }
    #tok-row #tok-login { width: 100% !important; min-height: 46px !important; flex: none; }
    #tok-row #tok-in { width: 100% !important; min-height: 46px !important; font-size: 16px !important; }
    .theme-toggle { min-height: 40px; font-size: 13px; padding: 6px 12px; }
    .grid3 { grid-template-columns: 1fr !important; gap: 8px; }
    .stat { border-left: none; border-top: 3px solid var(--glass-border); padding: 14px 16px !important; }
    .stat.s-a { border-top-color: var(--green); } .stat.s-c { border-top-color: var(--yellow); } .stat.s-d { border-top-color: var(--amber); }
    .stat .num { font-size: 24px; }
    table { font-size: 14px; }
    .card table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    th, td { padding: 10px 8px; white-space: nowrap; }
    .sec-h { font-size: 22px; }
    .sec-sub { font-size: 13px; margin-bottom: 10px; }
    .center, .card.r1, .card.r2 { padding: 16px 14px !important; }
    #modalAddKey { position: fixed !important; left: 50% !important; top: 50% !important; transform: translate(-50%,-50%) !important;
      width: calc(100vw - 24px) !important; max-width: 560px !important; max-height: 86vh !important; overflow-y: auto !important; border-radius: 20px !important; }
    /* ---- narrow-screen fixes (mobile audit 2026-11-07) ---- */
    /* Card headers: let the title row wrap instead of squeezing the summary into a vertical column of single characters. */
    .card h2 { flex-wrap: wrap; }
    #keylist-summary { flex: 1 1 100%; margin: 0 !important; }
    /* Forms: stack fields full-width so selects/inputs are never truncated. */
    .row { flex-direction: column; align-items: stretch; }
    .row > div { width: 100%; }
    /* Bottom bar: nav only (brand + account group moved to the top bar above). The active tab is scrolled into view by selectSection. */
    /* Key 列表：表格变卡片，操作按钮换行，不再横向溢出。 */
    #sec-keylist .card table { overflow-x: visible; }
    #sec-keylist thead { display: none; }
    #sec-keylist tbody, #sec-keylist tbody tr { display: block; }
    #sec-keylist tr[data-id] { border: 1px solid var(--glass-border); border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; background: var(--glass); }
    #sec-keylist tr[data-id] td { display: block; white-space: normal !important; padding: 3px 0 !important; border: none !important; }
    #sec-keylist tr[data-id] td::before { color: var(--faint); font-size: 12px; margin-right: 6px; }
    #sec-keylist tr[data-id] td:nth-child(1)::before { content: "供应商："; }
    #sec-keylist tr[data-id] td:nth-child(2)::before { content: "Key："; }
    #sec-keylist tr[data-id] td:nth-child(3)::before { content: "请求/失败："; }
    #sec-keylist tr[data-id] td:nth-child(4)::before { content: "上次错误："; }
    #sec-keylist tr[data-id] td:nth-child(5)::before { content: "测活/余额："; }
    #sec-keylist tr[data-id] td:nth-child(6)::before { content: "添加时间："; }
    #sec-keylist tr[data-id] td:nth-child(7) { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 10px !important; }
    #sec-keylist tr[data-id] td:nth-child(7)::before { content: none; }
    #sec-keylist tr.kl-addmodel-row, #sec-keylist tr.kl-edit-row, #sec-keylist tr.kl-del-row { display: block; margin-bottom: 12px; }
    #sec-keylist tr.kl-addmodel-row td, #sec-keylist tr.kl-edit-row td, #sec-keylist tr.kl-del-row td { display: block; white-space: normal !important; padding: 0 !important; border: none !important; }
    /* 新增模型面板：顶部筛选行换行（输入框占满一行，按钮到下一行），模型名断行。 */
    .kl-am-top { flex-wrap: wrap; }
    .kl-am-top .kl-am-q { flex: 1 1 100% !important; }
    .kl-am-list label { word-break: break-all; }
    /* 移动端拉取的模型列表紧凑化：字小、行距紧、复选框小，同样屏高多看约一倍模型。
       两处同款结构一起收：Key 列表「新增模型」面板（.kl-am-list）与「导入并选择模型」弹窗（#modelList）。
       label 行内写了 margin:4px 0，得用 !important 盖掉。注意：移动端 input 有 min-height:44px
       （给文本框的），会把复选框撑到 44px 高、整行变 50px——复选框必须归零 min-height。 */
    .kl-am-list label, #modelList label { font-size: 12px; line-height: 1.35; margin: 1px 0 !important; }
    .kl-am-list label input[type=checkbox], #modelList label input[type=checkbox] { width: 13px; height: 13px; min-height: 0 !important; margin-right: 4px; vertical-align: -2px; }
    .kl-am-list label .badge { font-size: 10px; padding: 1px 5px; }
    /* 通用：复选框/单选框不受移动端 input 44px 最小高影响（否则所有勾选行都被撑大）。 */
    input[type=checkbox], input[type=radio] { min-height: 0 !important; }
    /* 模型可用性报错：长 JSON 断行显示，不再单行截断。 */
    #modelstatus-body > div { word-break: break-all; }
  }
  @media (min-width: 821px) {
    .layout { flex-direction: row; }
    .side { position: sticky; height: fit-content; }
    .main { order: 0; }
  }
</style>
<script defer src="https://blog.leeguoo.com/scripts/visitor-beacon.js?v=20260629-2"></script>
<!-- Google Analytics 4 — shared leeguoo property (542876134); segment by hostname. -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-RCV0Z432Y8"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-RCV0Z432Y8');</script>
</head>
<body>
<svg width="0" height="0" style="position:absolute"><defs>
  <filter id="roughHi"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.5"/></filter>
</defs></svg>

<!-- ============ 1. landing (not logged in) ============ -->
<div id="view-landing" class="center" style="display:none">
  <header class="top">
    <span class="logo-dot"></span>
    <h1>__BRAND__</h1>
    <button class="theme-toggle" id="theme-toggle-landing" aria-label="切换主题">🌗 主题</button>
  </header>
  <div class="tagline">// 把一堆 AI key 攒成一个稳定的接口 · 坏了自动下架</div>
  <div class="card r1">
    <h2 class="h-red"><span class="hd"></span>登录</h2>
    <p style="margin:0 0 16px; color:var(--muted)">一个 OpenAI 兼容的 AI 网关。登录后即可申请 API 令牌。</p>
    <button class="btn primary" onclick="location.href='/auth/login'">__SSO_LABEL__</button>
    <div id="tok-row" style="margin:14px 0 4px; display:flex; gap:8px">
      <input id="tok-in" type="text" placeholder="粘贴管理员 Token 登录" style="flex:1; min-width:0; padding:10px 12px; border:1px solid var(--glass-border); border-radius:12px; background:var(--glass-strong); color:var(--ink)" />
      <button class="btn" id="tok-login" style="flex:none; width:auto">登录</button>
    </div>
    <div class="hint">__SSO_NOTE__</div>
  </div>
  <div class="card r2" id="landing-models" style="display:none">
    <h2 class="h-green"><span class="hd"></span>可用模型</h2>
    <table>
      <thead><tr><th>模型 id</th><th>来源</th></tr></thead>
      <tbody id="landing-models-body"><tr><td colspan="2" style="color:var(--faint)">加载中…</td></tr></tbody>
    </table>
  </div>
</div>

<!-- ============ 2. pending / blocked ============ -->
<div id="view-pending" class="center" style="display:none">
  <header class="top">
    <span class="logo-dot"></span>
    <h1>__BRAND__</h1>
  </header>
  <div class="tagline">// 账号开通制 · 管理员审核后开通</div>
  <div class="card r1">
    <h2 class="h-yellow"><span class="hd"></span>账号待开通</h2>
    <p style="margin:0 0 6px">当前账号：<b id="pending-email"></b></p>
    <p id="pending-msg" style="margin:0 0 16px; color:var(--muted)">已提交，等待管理员开通后即可获取 API 令牌。</p>
    <div class="row" style="align-items:center">
      <button class="btn ghost" id="pending-refresh">刷新</button>
      <a href="/auth/logout" class="btn ghost" style="text-decoration:none" onclick="try{localStorage.removeItem('kp_token')}catch(e){}">退出</a>
      <button class="theme-toggle" id="theme-toggle-pending" aria-label="切换主题" style="margin-left:8px">🌗 主题</button>
    </div>
  </div>
</div>

<!-- ============ 3 & 4. console (sidebar + content) ============ -->
<div id="view-console" class="layout" style="display:none">
  <aside class="side">
    <div class="brand"><span class="logo-dot"></span><h1>__BRAND__</h1></div>
    <div class="subt">// AI key 池</div>
    <nav class="nav" id="nav"></nav>
    <a class="navitem" id="preview-toggle" style="display:none; color:var(--blue); margin-top:6px; font-size:15px"></a>
    <div class="spacer"></div>
    <div class="me-box">
      <span class="em" id="me-email"></span>
      <span class="pill" id="me-rolepill"><span class="pd"></span><span id="me-role"></span></span>
      <a href="/auth/logout" class="btn ghost small" style="text-decoration:none; margin-left:6px" onclick="try{localStorage.removeItem('kp_token')}catch(e){}">退出</a>
      <button class="theme-toggle" id="theme-toggle-side" aria-label="切换主题" style="margin-top:8px; width:100%; justify-content:center">🌗 主题</button>
    </div>
  </aside>

  <main class="main">
    <div class="wrap">

      <!-- ----- consumer: 控制台 ----- -->
      <section class="section" id="sec-dashboard">
        <h2 class="sec-h">控制台</h2>
        <p class="sec-sub" id="dash-greet">// 欢迎回来</p>
        <div class="card r1">
          <h2 class="h-blue"><span class="hd"></span>接入地址</h2>
          <div class="hint" style="margin-top:0">主接口(OpenAI 兼容):</div>
          <div class="endpoint"><span class="copyable" id="dash-endpoint"></span></div>
          <div id="dash-token-area" style="margin-top:16px"></div>
        </div>
        <div class="grid3">
          <div class="stat">
            <div class="num" id="dash-balance" style="color:var(--red)">…</div>
            <div class="lbl">余额 (USD)</div>
            <div class="hint" id="dash-bal-hint" style="display:none">余额不足，请充值</div>
            <button class="btn ghost small" id="dash-topup" style="margin-top:8px">充值</button>
          </div>
          <div class="stat">
            <div class="num" id="dash-req">…</div>
            <div class="lbl">近30天请求</div>
          </div>
          <div class="stat">
            <div class="num" id="dash-tok">…</div>
            <div class="lbl">近30天 token</div>
          </div>
        </div>
        <div class="card r2">
          <h2 class="h-green"><span class="hd"></span>快速开始
            <span style="flex:1"></span>
            <button class="btn ghost small" id="dash-curl-copy">复制</button>
          </h2>
          <div class="out" id="dash-curl"></div>
          <div class="hint">把 <code>$KEY</code> 换成上面的令牌即可。模型 id 见「模型」页。</div>
        </div>
      </section>

      <!-- ----- consumer: 我的令牌 ----- -->
      <section class="section" id="sec-tokens">
        <h2 class="sec-h">我的令牌</h2>
        <p class="sec-sub">// 这些令牌只属于你 · 妥善保管</p>
        <div class="card r1">
          <h2 class="h-blue"><span class="hd"></span>新建令牌</h2>
          <div class="row">
            <div><label>令牌名(可选)</label><input id="my-tname" placeholder="例如 my-app" autocomplete="off" /></div>
            <button class="btn primary" id="my-mint">生成令牌</button>
          </div>
          <div class="out" id="my-mint-out" style="display:none"></div>
        </div>
        <div class="card r2">
          <h2 class="h-green"><span class="hd"></span>令牌列表
            <span style="flex:1"></span>
            <button class="btn ghost small" id="my-tokens-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>id</th><th>名字</th><th>令牌</th><th>启用</th><th>用量</th><th>限速</th><th>有效期</th><th>创建</th><th></th></tr></thead>
            <tbody id="my-token-list"><tr><td colspan="9" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- ----- shared: 模型 ----- -->
      <section class="section" id="sec-models">
        <h2 class="sec-h">模型</h2>
        <p class="sec-sub">// 当前可路由的模型</p>
        <p class="hint" style="margin-top:0">仅展示当前有可用 key、且未被标记下线的模型;不可用会自动移除</p>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>可用模型<span style="flex:1"></span><span class="hint" id="models-updated" style="margin:0"></span><button class="btn ghost small" id="models-refresh">刷新</button></h2>
          <table>
            <thead><tr><th>模型 id</th><th>来源</th></tr></thead>
            <tbody id="models-body"><tr><td colspan="2" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- ----- consumer: 模型排行 ----- -->
      <section class="section" id="sec-modelstats">
        <h2 class="sec-h">模型排行</h2>
        <p class="sec-sub">// 按真实调用数据对比,挑选最合适的模型</p>
        <p class="hint" style="margin-top:0">近 7 天全网真实请求统计。延迟、平均输出按成功请求计算;价格为你实际支付价(已含折扣)。点表头可排序:延迟低=快,价格低=省。</p>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>模型对比<span style="flex:1"></span><button class="btn ghost small" id="modelstats-refresh">刷新</button></h2>
          <table>
            <thead><tr>
              <th>模型</th><th>来源</th>
              <th class="ms-sort n" data-sort="avg_latency">响应延迟 ▲</th>
              <th class="ms-sort n" data-sort="rate">成功率</th>
              <th class="ms-sort n" data-sort="price" title="每 100 万 token 美元价(已含折扣),入/出">价格 $/1M 入/出</th>
              <th class="ms-sort n" data-sort="avg_out">平均输出</th>
              <th class="ms-sort n" data-sort="n">近7天调用</th>
            </tr></thead>
            <tbody id="modelstats-body"><tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
          <div class="hint">响应延迟:开始返回的耗时(流式为首字节 TTFT,非流式为整次往返)。价格 = 每 100 万 token 的美元单价(已含折扣),按输出价排序。样本越多越可信;无成功样本的模型延迟显示 –。</div>
        </div>
      </section>

      <!-- ----- shared: 文档 ----- -->
      <section class="section" id="sec-docs">
        <h2 class="sec-h">文档</h2>
        <p class="sec-sub">// OpenAI / Anthropic 兼容 · 同一套 SDK 即可接入</p>
        <div class="card r1">
          <h2 class="h-blue"><span class="hd"></span>接口与鉴权</h2>
          <div class="hint" style="margin-top:0">Chat Completions 接口:</div>
          <div class="endpoint copyable" id="docs-endpoint" title="点击复制"></div>
          <div class="hint">鉴权头:</div>
          <div class="endpoint">Authorization: Bearer &lt;你的令牌&gt;</div>
        </div>
        <div class="card r2">
          <h2 class="h-green"><span class="hd"></span>curl<span style="flex:1"></span><button class="btn ghost small" id="docs-curl-copy">复制</button></h2>
          <div class="out" id="docs-curl"></div>
        </div>
        <div class="card r1">
          <h2 class="h-yellow"><span class="hd"></span>OpenAI SDK<span style="flex:1"></span><button class="btn ghost small" id="docs-sdk-copy">复制</button></h2>
          <div class="out" id="docs-sdk"></div>
        </div>

        <div class="card r2">
          <h2 class="h-yellow"><span class="hd"></span>Anthropic 兼容(Claude SDK)<span style="flex:1"></span><button class="btn ghost small" id="docs-anthropic-copy">复制</button></h2>
          <div class="hint" style="margin-top:0">网关同时实现 Anthropic Messages 接口,Claude 官方 SDK / Claude Code 可直接接入:</div>
          <div class="endpoint">POST <span id="docs-anthropic-ep" class="copyable" title="点击复制"></span></div>
          <div class="hint">鉴权:<code>x-api-key: &lt;你的令牌&gt;</code> 或 <code>Authorization: Bearer &lt;你的令牌&gt;</code>。<code>base_url</code> 用上面的 Base URL,模型 id 与 OpenAI 接口<b>同一套</b>。</div>
          <div class="out" id="docs-anthropic"></div>
          <div class="hint">请求体为 Anthropic 格式:<code>messages</code> + <code>max_tokens</code>(必填)。响应同样带 <code>X-KeyPool-Provider</code> / <code>X-KeyPool-Model</code> / <code>X-KeyPool-Fallback</code> 响应头(回退后 Model 可能与请求不同)。</div>
        </div>
        <div class="card r2">
          <h2 class="h-blue"><span class="hd"></span>模型 id</h2>
          <table>
            <thead><tr><th>模型 id</th><th>来源</th></tr></thead>
            <tbody id="docs-models-body"><tr><td colspan="2" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>

        <div class="card r1">
          <h2 class="h-blue"><span class="hd"></span>POST /v1/chat/completions<span style="flex:1"></span><button class="btn ghost small" id="docs-reqbody-copy">复制</button></h2>
          <div class="hint" style="margin-top:0">Base URL(OpenAI <code>baseURL</code> 用这个):</div>
          <div class="endpoint copyable" id="docs-baseurl" title="点击复制"></div>
          <div class="hint">请求体(与 OpenAI 一致;支持 <code>stream:true</code> SSE 流式):</div>
          <div class="out" id="docs-reqbody"></div>
          <div class="hint">网关默认会在所选模型不可用时<b>自动回退</b>到同类可用模型。要关闭回退、强制只用所选模型,加 <code>"fallback": false</code>(此时模型不可用直接返回错误)。</div>
        </div>

        <div class="card r2">
          <h2 class="h-green"><span class="hd"></span>响应头</h2>
          <table>
            <thead><tr><th>响应头</th><th>含义</th></tr></thead>
            <tbody>
              <tr><td class="mono-token">X-KeyPool-Provider</td><td style="color:var(--muted)">实际命中的供应商(如 gemini)</td></tr>
              <tr><td class="mono-token">X-KeyPool-Model</td><td style="color:var(--muted)">实际使用的模型 id(回退后可能与请求不同)</td></tr>
              <tr><td class="mono-token">X-KeyPool-Fallback</td><td style="color:var(--muted)">出现即表示发生了回退,值为 "1"</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card r1">
          <h2 class="h-yellow"><span class="hd"></span>其它接口</h2>
          <div class="hint" style="margin-top:0"><code>GET /v1/models</code> — 列出当前可路由的模型(仅含有可用 key、且未被标记不可用的模型):</div>
          <div class="endpoint">GET <span id="docs-models-ep" class="copyable" title="点击复制"></span></div>
          <div class="hint">原生透传(直接用各家原生协议,网关只负责选 key 与计费):</div>
          <div class="endpoint">/gemini/*&nbsp;&nbsp;·&nbsp;&nbsp;/mistral/*&nbsp;&nbsp;·&nbsp;&nbsp;/openrouter/*</div>
          <div class="hint">把上游的原生路径接在前缀后即可,例如 <code>/gemini/v1beta/models/...:generateContent</code>。鉴权同样用 <code>Authorization: Bearer &lt;你的令牌&gt;</code>。</div>
        </div>

        <div class="card r1">
          <h2 class="h-red"><span class="hd"></span>错误码</h2>
          <div class="hint" style="margin-top:0">错误响应为 OpenAI 兼容结构,错误信息在 <code>body.error.message</code>:</div>
          <table>
            <thead><tr><th>状态码</th><th>含义 / 处理</th></tr></thead>
            <tbody>
              <tr><td class="mono-token">402</td><td style="color:var(--muted)">余额不足 — 充值后重试</td></tr>
              <tr><td class="mono-token">429</td><td style="color:var(--muted)">限流 / 额度超限 — 退避后重试</td></tr>
              <tr><td class="mono-token">4xx</td><td style="color:var(--muted)">请求错误(参数 / 模型 id / 鉴权)</td></tr>
              <tr><td class="mono-token">5xx</td><td style="color:var(--muted)">上游错误 — 稍后重试</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card r2">
          <h2 class="h-red"><span class="hd"></span>计费</h2>
          <div class="hint" style="margin-top:0">按 token 计费:每次调用按输入 / 输出 token 数分别结算,价格见管理员配置的「模型价格」。余额不足时请求会被拒绝。用量与流水见「用量」与「余额」页。</div>
        </div>
      </section>

      <!-- ----- admin: 总览 ----- -->
      <section class="section" id="sec-overview">
        <h2 class="sec-h">总览</h2>
        <p class="sec-sub">// key 池健康度</p>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>池子状态
            <span id="ov-verdict" class="hint" style="margin:0 0 0 12px"></span>
            <span style="flex:1"></span>
            <span id="ov-stamp" class="hint" style="margin:0 10px 0 0"></span>
            <button class="btn ghost small" id="ov-probe">巡检</button>
            <button class="btn ghost small" id="ov-refresh">刷新</button>
          </h2>
          <div class="grid3">
            <div class="stat s-a"><div class="lbl">可用 active</div><div class="num" id="t-active">–</div></div>
            <div class="stat s-c"><div class="lbl">冷却 cooldown</div><div class="num" id="t-cooldown">–</div></div>
            <div class="stat s-d"><div class="lbl">禁用 disabled</div><div class="num" id="t-disabled">–</div></div>
          </div>
          <table style="margin-top:16px">
            <thead><tr><th>供应商</th><th>可用</th><th>冷却</th><th>禁用</th></tr></thead>
            <tbody id="ov-byprovider"><tr><td colspan="4" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
          <div class="out" id="ov-probe-out" style="display:none"></div>
        </div>
      </section>

      <!-- ----- admin: Key 池 ----- -->
      <section class="section" id="sec-keys">
        <h2 class="sec-h">Key 池</h2>
        <p class="sec-sub">// 导入即上架 · 坏 key 自动下架</p>
        <div class="card r2">
          <h2 class="h-yellow"><span class="hd"></span>导入 key</h2>
          <label>provider:key — 一行一个</label>
          <textarea id="keys" spellcheck="false" placeholder="gemini:AIzaSy...&#10;openrouter:sk-or-v1-...&#10;mistral:..."></textarea>
          <div style="margin-top:13px; display:flex; flex-wrap:wrap; gap:8px"><button class="btn primary" id="importBtn">导入并自动上架</button><button class="btn primary" id="importSelectBtn">导入并选择模型</button><button class="btn primary" id="customServiceBtn">添加自定义服务</button></div>
<div class="out" id="importOut" style="display:none"></div>
          <div class="hint">支持 <code>gemini</code> <code>openai</code> <code>mistral</code> <code>openrouter</code> <code>deepseek</code> <code>groq</code> <code>moonshot</code> <code>glm</code> <code>qwen</code> <code>deepinfra</code> <code>fireworks</code> <code>cerebras</code> <code>ai21</code> <code>cohere</code> <code>elevenlabs</code> <code>stability</code>。重复自动跳过；坏 key 首次调用即自动禁用。</div>
          <div id="customServicePanel" style="display:none;margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="csSlug" placeholder="服务名，如 2api" style="width:130px">
              <input id="csBaseUrl" placeholder="API 地址，如 https://ai.example.com/v1" style="flex:2;min-width:220px">
              <input id="csKey" type="password" placeholder="API Key" style="flex:1;min-width:160px">
            </div>
            <div class="hint" style="margin-top:6px">OpenAI 兼容接口：地址可带 /v1 也可不带，会自动补。添加后模型写作 <code>custom:服务名:模型名</code>，例如 <code>custom:2api:gpt-4o</code>；同一服务名只能对应一个地址。</div>
            <div style="margin-top:10px"><button class="btn primary" id="csAdd">添加并拉取模型</button><button class="btn ghost" id="csCancel" style="margin-left:8px">取消</button></div>
            <div class="out" id="csOut" style="display:none"></div>
            <div id="csModels" style="display:none;margin-top:10px">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input id="csQ" placeholder="筛选模型…" style="flex:1"><button class="btn primary small" id="csAddSel" disabled>添加选中</button></div>
              <div class="hint" id="csStatus">正在拉取模型列表…</div>
              <div id="csList" style="max-height:220px;overflow:auto;margin-top:6px"></div>
              <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px"><div class="hint" style="margin-bottom:4px">手动输入模型（每行一个；上游列表拉不到时用这个）</div>
              <textarea id="csCustom" rows="2" placeholder="例如 gpt-4o" style="width:100%;box-sizing:border-box"></textarea>
              <div style="margin-top:6px"><button class="btn small" id="csAddCustom">添加手动模型</button></div></div>
            </div>
          </div>
          <div class="out" id="importOut2" style="display:none"></div>
        </div>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>各供应商状态
            <span style="flex:1"></span>
            <button class="btn ghost small" id="keys-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>供应商</th><th>可用</th><th>冷却</th><th>禁用</th></tr></thead>
            <tbody id="keys-byprovider"><tr><td colspan="4" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
          <div class="hint" style="margin-top:10px">需要逐个查看？<button class="btn ghost small" id="keys-tokeylist">逐个 key 管理 →</button></div>
        </div>
        <div class="card r2">
          <h2 class="h-red"><span class="hd"></span>模型可用性
            <span style="flex:1"></span>
            <button class="btn ghost small" id="modelstatus-probe">探测模型</button>
            <button class="btn ghost small" id="modelstatus-refresh">刷新</button>
          </h2>
          <div id="modelstatus-body" class="hint" style="margin-top:0">加载中…</div>
          <div class="hint">逐个模型试调一次,把不可用的(余额不足 / 模型下线)标灰;不可用的模型不会出现在 <code>/v1/models</code>。</div>
          <div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px">
            <div class="hint" style="margin-bottom:4px">添加自定义模型：不在上游列表里的模型 ID 也可以直接加（每行一个；下次探活会自动验证，调不通的会被屏蔽）</div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><label style="white-space:nowrap">加到</label><select id="pool-custom-key" style="flex:1"></select></div>
            <textarea id="pool-custom-input" rows="2" placeholder="模型 ID，每行一个，例如 openai/gpt-oss-120b:free" style="width:100%;box-sizing:border-box"></textarea>
            <div style="margin-top:6px"><button class="btn small" id="pool-custom-add">添加自定义模型</button></div>
            <div class="hint" id="pool-custom-out" style="margin-top:6px"></div>
          </div>
        </div>
      </section>

      <!-- ----- admin: Key 列表 ----- -->
      <section class="section" id="sec-keylist">
        <h2 class="sec-h">Key 列表</h2>
        <p class="sec-sub">// 每个 key 单独查看与操作 · 测活 / 余额(OpenRouter)</p>
        <div class="card r1">
          <h2 class="h-red"><span class="hd"></span>所有 key
            <span id="keylist-summary" class="hint" style="margin:0 0 0 12px"></span>
            <span style="flex:1"></span>
            <span id="keylist-checkall-out" class="hint" style="margin:0 10px 0 0"></span>
            <button class="btn ghost small" id="keylist-toggle">显示禁用</button>
            <button class="btn primary small" id="keylist-checkall">检测全部</button>
            <button class="btn ghost small" id="keylist-prune">清理失效</button>
            <button class="btn ghost small" id="keylist-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>供应商</th><th>key</th><th>请求/失败</th><th>上次错误</th><th>测活 / 余额</th><th>添加时间</th><th>操作</th></tr></thead>
            <tbody id="keylist-body"><tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
          <div class="hint">「测活」实时探测:OpenRouter 显示真实余额;Gemini/Mistral 只能判断是否可用(限流也算可用)。探活成功会自动把禁用/冷却的 key 拉回可用。「新增模型」用该 key 实时拉取上游模型列表，勾选后加入 /v1/models。</div>
        </div>
      </section>

      <!-- ----- admin: 模型映射 ----- -->
      <section class="section" id="sec-aliases">
        <h2 class="sec-h">模型映射</h2>
        <p class="sec-sub">// 一个虚拟模型名，映射到一个或多个真实模型</p>
        <div class="card r2">
          <h2 class="h-blue"><span class="hd"></span>新建 / 修改映射</h2>
          <div class="row">
            <div><label>映射名</label><input id="alias-name" placeholder="例如 abc" autocomplete="off" /></div>
            <div><label>策略</label><select id="alias-strategy"><option value="failover">故障转移（按顺序试）</option><option value="loadbalance">负载均衡（每次随机挑一个）</option></select></div>
            <button class="btn primary" id="alias-save">保存映射</button>
          </div>
          <div style="margin-top:10px"><label>目标模型（每行一个真实模型 id，例如 openai/gpt-4o 或 custom:aihubmix:deepseek-chat）</label><textarea id="alias-targets" rows="3" placeholder="openai/gpt-4o&#10;custom:aihubmix:deepseek-chat" style="width:100%"></textarea></div>
          <p class="hint">映射名只能是字母、数字、-、_（不能叫 auto）。客户端用映射名调聊天时，网关按策略走到真实模型；发一个「仅映射」范围的令牌，/v1/models 里就只看到这些映射名。</p>
          <div class="out" id="alias-out" style="display:none"></div>
        </div>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>映射列表
            <span style="flex:1"></span>
            <button class="btn ghost small" id="aliases-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>映射名</th><th>目标模型</th><th>策略</th><th>启用</th><th>操作</th></tr></thead>
            <tbody id="alias-list"><tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- ----- admin: 用户 ----- -->
      <section class="section" id="sec-users">
        <h2 class="sec-h">用户</h2>
        <p class="sec-sub">// 开通制 · 待开通的排在最上面</p>
        <div class="card r1">
          <h2 class="h-red"><span class="hd"></span>用户列表
            <span id="users-pending" class="badge" style="margin:0 0 0 12px"></span>
            <span style="flex:1"></span>
            <button class="btn ghost small" id="users-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>创建</th><th></th></tr></thead>
            <tbody id="users-body"><tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- ----- admin: 令牌 ----- -->
      <section class="section" id="sec-admintokens">
        <h2 class="sec-h">令牌</h2>
        <p class="sec-sub">// 全局令牌 · 含管理员直发</p>
        <div class="card r2">
          <h2 class="h-blue"><span class="hd"></span>发令牌</h2>
          <div class="row">
            <div><label>令牌名(可选)</label><input id="adm-tname" placeholder="例如 service-x" autocomplete="off" /></div>
            <div><label>配额(请求数)</label><input id="adm-quota" type="number" min="1" placeholder="无限" /></div>
            <div><label>限速(RPM)</label><input id="adm-rpm" type="number" min="1" placeholder="无限" /></div>
            <div><label>有效期(天)</label><input id="adm-exp" type="number" min="1" placeholder="永久" /></div>
            <div><label>角色</label><select id="adm-role"><option value="user">用户</option><option value="admin">管理员</option></select></div>
            <div><label>范围</label><select id="adm-scope"><option value="full">全部模型</option><option value="aliases">仅映射模型</option></select></div>
            <button class="btn primary" id="adm-mint">发一个令牌</button>
          </div>
          <p class="hint">仅显示一次，请立即复制保存</p>
          <div class="out" id="adm-mint-out" style="display:none"></div>
        </div>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>令牌列表
            <span style="flex:1"></span>
            <button class="btn ghost small" id="adm-tokens-refresh">刷新</button>
          </h2>
          <table>
            <thead><tr><th>id</th><th>名字</th><th>角色</th><th>归属</th><th>用量</th><th>RPM</th><th>过期</th><th>启用</th><th>创建</th><th>操作</th></tr></thead>
            <tbody id="adm-token-list"><tr><td colspan="10" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

      <!-- ----- consumer: 聊天 ----- -->
      <section class="section" id="sec-chat">
        <h2 class="sec-h">聊天</h2>
        <p class="sec-sub">// 选个模型直接聊 · 按 token 计费</p>
        <div class="card r1">
          <div class="row" style="margin-bottom:10px">
            <div><label>模型</label><select id="chat-model"></select></div>
            <button class="btn ghost small" id="chat-clear">清空</button>
          </div>
          <div class="hint" id="chat-balance" style="margin-bottom:10px">剩余余额 <span id="chat-bal-usd">–</span> USD</div>
          <div id="chat-log" style="min-height:180px; max-height:420px; overflow:auto; border:2px dashed #cfcbbd; border-radius:12px; padding:12px; background:var(--creamy)"><span style="color:var(--faint)">开始对话…</span></div>
          <div class="row" style="margin-top:12px; align-items:stretch">
            <div><textarea id="chat-input" style="min-height:56px" placeholder="说点什么…(Enter 发送,Shift+Enter 换行)"></textarea></div>
            <button class="btn primary" id="chat-send">发送</button>
          </div>
        </div>
      </section>

      <!-- ----- admin: 调试聊天 ----- -->
      <section class="section" id="sec-debugchat">
        <h2 class="sec-h">调试聊天</h2>
        <p class="sec-sub">// 用某个 key 直连试聊 · 不走池子 · 不计费</p>
        <div class="card r1">
          <div class="row" style="margin-bottom:10px">
            <div style="flex:2"><label>选 key</label><select id="dbg-key"></select></div>
            <div><label>模型(留空=默认)</label><select id="dbg-model"></select></div>
            <div style="max-width:108px"><label>max_tokens</label><input id="dbg-maxtok" type="number" min="1" placeholder="256" autocomplete="off" /></div>
            <button class="btn ghost small" id="dbg-clear">清空</button>
          </div>
          <span class="hint" style="display:block;margin:0 0 8px">调试回复默认截断在 256 token</span>
          <div id="dbg-health" class="hint" style="display:none;margin:0 0 8px"></div>
          <div id="dbg-log" style="min-height:180px; max-height:420px; overflow:auto; border:2px dashed #cfcbbd; border-radius:12px; padding:12px; background:var(--creamy)"><span style="color:var(--faint)">选一个 key,直连试聊…</span></div>
          <div class="row" style="margin-top:12px; align-items:stretch">
            <div><textarea id="dbg-input" style="min-height:56px" placeholder="测试这个 key…"></textarea></div>
            <button class="btn primary" id="dbg-send">发送</button>
          </div>
        </div>
      </section>

      <!-- ----- consumer: 用量 ----- -->
      <section class="section" id="sec-usage">
        <h2 class="sec-h">用量</h2>
        <p class="sec-sub">// 近 30 天 · 你自己的调用</p>
        <div class="grid3">
          <div class="stat s-a"><div class="lbl">总请求</div><div class="num" id="u-total">–</div></div>
          <div class="stat s-c"><div class="lbl">成功率</div><div class="num" id="u-rate">–</div></div>
          <div class="stat s-d"><div class="lbl">总 token</div><div class="num" id="u-tokens">–</div></div>
        </div>
        <div class="card r2" style="margin-top:14px">
          <h2 class="h-yellow"><span class="hd"></span>近 14 天请求
            <span style="flex:1"></span>
            <span class="hint" style="margin:0"><span class="dot d-active" style="margin-right:3px"></span>成功 <span class="dot d-disabled" style="margin:0 3px 0 10px"></span>失败</span>
          </h2>
          <div id="u-chart"></div>
        </div>
        <div class="card r1" style="margin-top:14px">
          <h2 class="h-green"><span class="hd"></span>按供应商
            <span style="flex:1"></span>
            <button class="btn ghost small" id="usage-refresh">刷新</button>
          </h2>
          <table><thead><tr><th>供应商</th><th>请求</th><th>成功</th><th>平均延迟</th><th>token</th></tr></thead>
          <tbody id="u-byprov"><tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr></tbody></table>
        </div>
        <div class="card r2" style="margin-top:14px">
          <h2 class="h-blue"><span class="hd"></span>最近请求</h2>
          <table><thead><tr><th>时间</th><th>供应商</th><th>模型</th><th>状态</th><th>延迟</th><th>token</th></tr></thead>
          <tbody id="u-recent"><tr><td colspan="6" style="color:var(--faint)">加载中…</td></tr></tbody></table>
        </div>
      </section>

      <!-- ----- admin: 日志 ----- -->
      <section class="section" id="sec-logs">
        <h2 class="sec-h">日志</h2>
        <p class="sec-sub">// 近 30 天 · 全部调用</p>
        <div class="grid3">
          <div class="stat s-a"><div class="lbl">总请求</div><div class="num" id="l-total">–</div></div>
          <div class="stat s-c"><div class="lbl">成功率</div><div class="num" id="l-rate">–</div></div>
          <div class="stat s-d"><div class="lbl">总 token</div><div class="num" id="l-tokens">–</div></div>
        </div>
        <div class="card r2" style="margin-top:14px">
          <h2 class="h-yellow"><span class="hd"></span>近 14 天请求
            <span style="flex:1"></span>
            <span class="hint" style="margin:0"><span class="dot d-active" style="margin-right:3px"></span>成功 <span class="dot d-disabled" style="margin:0 3px 0 10px"></span>失败</span>
          </h2>
          <div id="l-chart"></div>
        </div>
        <div class="card r1" style="margin-top:14px">
          <h2 class="h-green"><span class="hd"></span>按供应商
            <span style="flex:1"></span>
            <button class="btn ghost small" id="logs-refresh">刷新</button>
          </h2>
          <table><thead><tr><th>供应商</th><th>请求</th><th>成功</th><th>平均延迟</th><th>token</th></tr></thead>
          <tbody id="l-byprov"><tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr></tbody></table>
        </div>
        <div class="card r1" style="margin-top:14px">
          <h2 class="h-red"><span class="hd"></span>用户使用排行 · 近 30 天
            <span style="flex:1"></span>
            <button class="btn ghost small" id="rank-refresh">刷新</button>
          </h2>
          <table><thead><tr><th>#</th><th>用户</th><th>请求</th><th>成功率</th><th>token</th><th>最近</th></tr></thead>
          <tbody id="l-rank"><tr><td colspan="6" style="color:var(--faint)">加载中…</td></tr></tbody></table>
          <div class="hint">点某一行可只看该用户的日志。</div>
        </div>
        <div class="card r2" style="margin-top:14px">
          <h2 class="h-blue"><span class="hd"></span>最近请求
            <span style="flex:1"></span>
            <select id="logs-user" class="btn ghost small" style="max-width:200px"><option value="">全部用户</option></select>
            <button class="btn ghost small" id="logs-prev" style="margin-left:6px" disabled>上一页</button>
            <span id="logs-page" class="hint" style="margin:0 6px">第 1 页</span>
            <button class="btn ghost small" id="logs-next" disabled>下一页</button>
          </h2>
          <table><thead><tr><th>时间</th><th>用户</th><th>供应商</th><th>模型</th><th>状态</th><th>延迟</th><th>token</th></tr></thead>
          <tbody id="l-recent"><tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr></tbody></table>
        </div>
      </section>

      <!-- ----- admin: 计费 ----- -->
      <section class="section" id="sec-billing">
        <h2 class="sec-h">计费</h2>
        <p class="sec-sub">// 余额 · 充值 · 流水 · 定价 <span id="bill-config" style="color:var(--ink)"></span></p>
        <div class="card r2">
          <h2 class="h-red"><span class="hd"></span>充值</h2>
          <div class="row">
            <div><label>用户 sub</label><input id="bill-sub" placeholder="OIDC sub" autocomplete="off" /></div>
            <div><label>金额(USD)</label><input id="bill-amount" type="number" step="0.0001" min="0" placeholder="例如 10" /></div>
            <div><label>备注(可选)</label><input id="bill-note" placeholder="例如 手动充值" autocomplete="off" /></div>
            <button class="btn primary" id="bill-topup">充值</button>
          </div>
          <div class="out" id="bill-topup-out" style="display:none"></div>
        </div>
        <div class="card r1">
          <h2 class="h-green"><span class="hd"></span>余额总览
            <span style="flex:1"></span>
            <button class="btn ghost small" id="bill-balances-refresh">刷新</button>
          </h2>
          <div class="grid3" style="margin-bottom:14px">
            <div class="stat"><div class="lbl">余额合计 USD</div><div class="num" id="bal-sum">–</div></div>
            <div class="stat"><div class="lbl">用户数</div><div class="num" id="bal-users">–</div></div>
            <div class="stat"><div class="lbl">付费用户数</div><div class="num" id="bal-paid">–</div></div>
          </div>
          <table>
            <thead><tr><th>邮箱</th><th>sub</th><th>余额 USD</th><th></th></tr></thead>
            <tbody id="bill-balances-body"><tr><td colspan="4" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
        <div class="card r2">
          <h2 class="h-blue"><span class="hd"></span>最近流水
            <span class="hint" style="margin-left:8px;font-weight:400">最多展示最近 100 条</span>
            <span style="flex:1"></span>
            <select id="bill-txns-user" class="btn ghost small" style="max-width:200px"><option value="">全部用户</option></select>
            <button class="btn ghost small" id="bill-txns-refresh" style="margin-left:6px">刷新</button>
          </h2>
          <table>
            <thead><tr><th>时间</th><th>用户</th><th>类型</th><th>金额 USD</th><th>余额 USD</th><th>模型</th><th>token</th><th>备注</th></tr></thead>
            <tbody id="bill-txns-body"><tr><td colspan="8" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
        <div class="card r1">
          <h2 class="h-yellow"><span class="hd"></span>模型价格
            <span style="flex:1"></span>
            <button class="btn ghost small" id="prices-refresh">刷新</button>
          </h2>
          <div class="row">
            <div><label>模型</label><input id="price-model" placeholder="例如 gemini-2.0-flash" autocomplete="off" /></div>
            <div><label>输入 $/Mtok</label><input id="price-input" type="number" step="0.0001" min="0" placeholder="例如 0.5" /></div>
            <div><label>输出 $/Mtok</label><input id="price-output" type="number" step="0.0001" min="0" placeholder="例如 1.5" /></div>
            <button class="btn primary" id="price-save">保存价格</button>
          </div>
          <div class="out" id="price-out" style="display:none"></div>
          <table style="margin-top:14px">
            <thead><tr><th>模型</th><th>输入 $/Mtok</th><th>输出 $/Mtok</th><th></th></tr></thead>
            <tbody id="prices-body"><tr><td colspan="4" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
          <div class="hint">价格以 micro-USD 每 Mtok 存储；按输入/输出 token 分别计费。</div>
        </div>
      </section>

      <!-- ----- consumer: 余额 ----- -->
      <section class="section" id="sec-balance">
        <h2 class="sec-h">余额</h2>
        <p class="sec-sub">// 你的额度与流水</p>
        <div class="card r1">
          <h2 class="h-red"><span class="hd"></span>当前余额
            <span style="flex:1"></span>
            <button class="btn ghost small" id="bal-refresh">刷新</button>
          </h2>
          <div class="grid3">
            <div class="stat s-a"><div class="lbl">余额 USD</div><div class="num" id="bal-usd">–</div></div>
          </div>
        </div>
        <div class="card r2">
          <h2 class="h-green"><span class="hd"></span>充值</h2>
          <div class="hint" id="bal-topup-success" style="display:none; color:var(--green); margin-top:0">充值处理中，到账后余额会自动更新（可稍后点「刷新」）。</div>
          <div class="row">
            <div><label>金额(USD)</label><input id="bal-topup-amount" type="number" step="0.01" min="0" placeholder="例如 10" /><div id="bal-topup-chips" style="display:flex; gap:6px; margin-top:6px"><button class="btn ghost small" data-amt="5">5</button><button class="btn ghost small" data-amt="10">10</button><button class="btn ghost small" data-amt="20">20</button><button class="btn ghost small" data-amt="50">50</button></div></div>
            <button class="btn primary" id="bal-topup-btn">充值</button>
          </div>
          <div class="out" id="bal-topup-out" style="display:none"></div>
          <div class="hint">通过 Stripe 在线支付。支付成功后余额会在确认后自动到账。</div>
        </div>
        <div class="card r1">
          <h2 class="h-blue"><span class="hd"></span>最近流水</h2>
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>金额 USD</th><th>余额 USD</th><th>模型</th><th>token</th><th>备注</th></tr></thead>
            <tbody id="bal-txns-body"><tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr></tbody>
          </table>
        </div>
      </section>

    </div>
  </main>
</div>

<!-- 导入并选择模型弹窗：必须是 body 的直接子节点。放在 .card 里会被卡片的
     backdrop-filter 困住（fixed 相对卡片定位、z-index 也出不去），下半截会被
     后面的「各供应商状态」卡片盖住；放 body 层 + 全端居中才盖得住整页。 -->
<div id="modalAddKey" class="card" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1000; width:90%; max-width:500px; max-height:86vh; overflow-y:auto;">
  <h2 class="h-green"><span class="hd"></span>导入并选择模型</h2>
  <label>提供商</label>
  <select id="addProvider"></select>
  <label>API Key</label>
  <input id="addKey" type="password" placeholder="粘贴 API Key"/>
  <label style="margin-top:10px;">搜索模型</label>
  <input id="modelSearch" type="text" placeholder="输入模型名过滤（模糊匹配）"/>
  <div id="modelList" style="margin-top:10px; max-height:200px; overflow:auto;"></div>
  <div id="modelCount" class="hint" style="margin-top:6px"></div>
  <div id="addStatus" class="hint" style="margin-top:6px;display:none"></div>
  <div style="margin-top:10px; display:flex; gap:10px;">
    <button class="btn primary" id="addConfirm">确认导入</button>
    <button class="btn ghost" id="addCancel">取消</button>
  </div>
</div>

<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var base = location.origin;
  var me = null;        // { email, role, status, sub }
  var modelsCache = null;

  // ---- same-origin fetch. Cookie auth first; token login stored in localStorage ----
  // A 120s timeout so a hung request fails visibly instead of spinning forever.
  function api(path, opts){
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({}, opts.headers||{});
    var tk = null;
    try{ tk = localStorage.getItem('kp_token'); }catch(e){}
    if (tk && !opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer '+tk;
    var ctrl = null;
    try {
      ctrl = new AbortController();
      opts.signal = ctrl.signal;
      setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 120000);
    } catch(e){}
    return fetch(base + path, opts).then(function(r){
      return r.text().then(function(t){
        var j=null; try{ j = t ? JSON.parse(t) : null; }catch(e){ j={raw:t}; }
        return { ok:r.ok, status:r.status, body:j };
      });
    });
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function pad2(n){ return (n<10?'0':'')+n; }
  // local time (was UTC via toISOString — showed CST users a -8h skew)
  function fmtDate(ms){ if(!ms) return '–'; try{ var d=new Date(ms); return pad2(d.getMonth()+1)+'-'+pad2(d.getDate())+' '+pad2(d.getHours())+':'+pad2(d.getMinutes()); }catch(e){ return '–'; } }
  function fmtNum(n){ try{ return (n==null?0:n).toLocaleString('en-US'); }catch(e){ return String(n==null?0:n); } }
  // enum → 中文 (UI is Simplified Chinese; backend stores English enums)
  var KIND_ZH={topup:'充值',charge:'消费',usage:'消费'};
  var ROLE_CN={admin:'管理员',user:'用户'};
  var STATUS_CN={pending:'待开通',approved:'已开通',blocked:'已停用'};
  function copy(text, el){
    var done=function(){ if(el){ var o=el.textContent; el.textContent='已复制'; setTimeout(function(){ el.textContent=o; },900); } };
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done,done); }
    else { try{ var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); }catch(e){} }
  }
  window.__kpCopy = copy; // bound in inline handlers

  function show(view){
    ['view-landing','view-pending','view-console'].forEach(function(v){ $(v).style.display='none'; });
    $(view).style.display = (view==='view-console') ? 'flex' : 'block';
  }

  // ---------------- models (shared) ----------------
  var modelsErr=false; // distinguish a failed /v1/models fetch from a genuinely empty pool
  var modelsFetchedAt=0; // ms of last successful /v1/models fetch (drives the 更新于 hint)
  // owned_by id → 显示名 (fallback to the raw id)
  var PROVIDER_ZH={gemini:'Google Gemini',openai:'OpenAI',deepseek:'DeepSeek',qwen:'通义千问',glm:'智谱GLM',moonshot:'Kimi',mistral:'Mistral',groq:'Groq',openrouter:'OpenRouter',custom:'自定义'};
  function loadModels(){
    return api('/v1/models').then(function(r){
      if(!r.ok){ modelsErr=true; modelsCache=[]; return []; }
      var list = (r.body && (r.body.data || r.body)) || [];
      if(!Array.isArray(list)) list = [];
      modelsErr=false; modelsCache = list; modelsFetchedAt = Date.now();
      return list;
    }).catch(function(){ modelsErr=true; modelsCache=[]; return []; });
  }
  function renderModelsInto(tbodyId){
    var tb=$(tbodyId); if(!tb) return;
    var list=modelsCache||[];
    if(modelsErr){ tb.innerHTML='<tr><td colspan="2"><span class="e">加载失败</span> · <button class="btn ghost small" id="'+tbodyId+'-retry">重试</button></td></tr>'; var rb=$(tbodyId+'-retry'); if(rb) rb.onclick=function(){ loadModels().then(function(){ renderModelsInto(tbodyId); }); }; return; }
    if(!list.length){ tb.innerHTML='<tr><td colspan="2" style="color:var(--faint)">暂无可用模型</td></tr>'; return; }
    tb.innerHTML = list.map(function(m){
      var d=MODEL_LABELS[m.id];
      var ob=String(m.owned_by||m.ownedBy||'').toLowerCase();
      var src=ob?'<span class="badge">'+esc(PROVIDER_ZH[ob]||m.owned_by||m.ownedBy)+'</span>':'<span style="color:var(--faint)">–</span>';
      return '<tr><td style="font-weight:700" class="mono-token copyable" data-copy="'+esc(m.id)+'" title="点击复制">'+esc(m.id)+(d?'<span style="font-weight:400;color:var(--faint)"> — '+esc(d)+'</span>':'')+'</td><td>'+src+'</td></tr>';
    }).join('');
    bindCopy(tb);
  }

  // ---------------- model leaderboard (consumer) ----------------
  var msRows=null;            // cached /me/model-stats rows
  var msSort='avg_latency';   // current sort key
  var msAsc=true;             // ascending? (latency default asc = fastest first)
  function loadModelStats(){
    var tb=$('modelstats-body'); if(!tb) return;
    tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr>';
    return api('/me/model-stats').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="7" style="color:var(--red)">加载失败 · <button class="btn ghost small" id="ms-retry">重试</button></td></tr>'; var rb=$('ms-retry'); if(rb) rb.onclick=loadModelStats; return; }
      msRows=Array.isArray(r.body)?r.body:[];
      renderModelStats();
    }).catch(function(){ tb.innerHTML='<tr><td colspan="7" style="color:var(--red)">网络错误</td></tr>'; });
  }
  // USD per 1M tokens from micro-USD, trimmed to a compact significant form.
  function mtokUsd(micro){ var v=(micro||0)/1e6; return v>=1?v.toFixed(2):v.toFixed(3); }
  // sort key; price sorts by output price (the dominant cost). Models with no
  // successful sample have meaningless latency/output, so they sink (Infinity in
  // asc, -Infinity in desc) for those columns — but price/rate/n stay comparable.
  function msVal(x,k){
    if(k==='rate') return x.n>0?x.ok/x.n:0;
    if(k==='n') return x.n||0;
    if(k==='price') return x.price_out_micro||0;
    if(x.ok<=0) return msAsc?Infinity:-Infinity; // latency/avg_out undefined without a success
    return x[k]||0;
  }
  function renderModelStats(){
    var tb=$('modelstats-body'); if(!tb) return;
    if(!msRows || !msRows.length){ tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">近 7 天还没有调用数据</td></tr>'; return; }
    var rows=msRows.slice().sort(function(a,b){ var d=msVal(a,msSort)-msVal(b,msSort); return msAsc?d:-d; });
    tb.innerHTML=rows.map(function(x){
      var d=MODEL_LABELS[x.model];
      var prov=x.provider?('<span class="badge">'+esc(PROVIDER_ZH[String(x.provider).toLowerCase()]||x.provider)+'</span>'):'<span style="color:var(--faint)">–</span>';
      var rate=x.n>0?Math.round(x.ok/x.n*100):0;
      var ratec=rate>=95?'var(--green)':(rate>=80?'var(--amber)':'var(--red)');
      var hasOk=x.ok>0;
      return '<tr><td style="font-weight:700" class="mono-token copyable" data-copy="'+esc(x.model)+'" title="点击复制">'+esc(x.model)+(d?'<span style="font-weight:400;color:var(--faint)"> — '+esc(d)+'</span>':'')+'</td>'
        +'<td>'+prov+'</td>'
        +'<td class="n">'+(hasOk?fmtNum(Math.round(x.avg_latency))+' ms':'<span style="color:var(--faint)">–</span>')+'</td>'
        +'<td class="n" style="color:'+ratec+'">'+rate+'%</td>'
        +'<td class="n" title="每 100 万 token 美元价(含折扣)">'+mtokUsd(x.price_in_micro)+' / '+mtokUsd(x.price_out_micro)+'</td>'
        +'<td class="n">'+(hasOk?fmtNum(Math.round(x.avg_out)):'<span style="color:var(--faint)">–</span>')+'</td>'
        +'<td class="n">'+fmtNum(x.n)+'</td></tr>';
    }).join('');
    bindCopy(tb);
    // reflect the active sort column + direction in the header arrows
    Array.prototype.forEach.call(document.querySelectorAll('#sec-modelstats .ms-sort'), function(th){
      var k=th.getAttribute('data-sort'); var base=th.textContent.replace(/[ ▲▼]+$/,'');
      th.textContent = base + (k===msSort ? (msAsc?' ▲':' ▼') : '');
      th.style.cursor='pointer';
    });
  }
  function initModelStats(){
    var rf=$('modelstats-refresh'); if(rf) rf.onclick=loadModelStats;
    Array.prototype.forEach.call(document.querySelectorAll('#sec-modelstats .ms-sort'), function(th){
      th.onclick=function(){
        var k=th.getAttribute('data-sort');
        // same column toggles direction; a new column defaults to latency-asc (fastest)
        // or descending for the rest (higher tps/rate/output/调用 = better first).
        if(msSort===k){ msAsc=!msAsc; } else { msSort=k; msAsc=(k==='avg_latency'); }
        renderModelStats();
      };
    });
    loadModelStats();
  }

  // ---------------- sidebar nav ----------------
  var NAV = {
    user: [
      {id:'dashboard', label:'控制台', color:'red'},
      {id:'chat',      label:'聊天', color:'blue'},
      {id:'tokens',    label:'我的令牌', color:'blue'},
      {id:'models',    label:'模型', color:'green'},
      {id:'modelstats',label:'模型排行', color:'green'},
      {id:'usage',     label:'用量', color:'amber'},
      {id:'balance',   label:'余额', color:'red'},
      {id:'docs',      label:'文档', color:'yellow'}
    ],
    admin: [
      {id:'overview',    label:'总览', color:'green'},
      {id:'debugchat',   label:'调试聊天', color:'blue'},
      {id:'keys',        label:'Key 池', color:'yellow'},
      {id:'keylist',     label:'Key 列表', color:'red'},
      {id:'aliases',     label:'模型映射', color:'blue'},
      {id:'users',       label:'用户', color:'blue'},
      {id:'admintokens', label:'令牌', color:'green'},
      {id:'logs',        label:'日志', color:'amber'},
      {id:'billing',     label:'计费', color:'red'},
      {id:'docs',        label:'文档', color:'amber'}
    ]
  };
  var previewUser=false;
  var navIds=[];
  function buildNav(role){
    var items = NAV[role] || NAV.user;
    navIds = items.map(function(it){ return it.id; });
    $('nav').innerHTML = items.map(function(it){
      return '<a class="navitem c-'+it.color+'" data-sec="'+it.id+'" href="#'+it.id+'"><span class="hd"></span>'+it.label+'</a>';
    }).join('');
    Array.prototype.forEach.call($('nav').querySelectorAll('.navitem'), function(a){
      a.onclick = function(ev){ ev.preventDefault(); var id=a.getAttribute('data-sec'); if(location.hash!=='#'+id) location.hash=id; else selectSection(id); };
    });
    // Honor the URL hash on (re)build; fall back to the first nav item.
    var want = location.hash.replace(/^#/,'');
    selectSection(navIds.indexOf(want)>=0 ? want : items[0].id);
  }
  function selectSection(id){
    if(navIds.indexOf(id)<0) id = navIds[0];
    Array.prototype.forEach.call(document.querySelectorAll('.section'), function(s){ s.classList.remove('active'); });
    var sec=$('sec-'+id); if(sec) sec.classList.add('active');
    Array.prototype.forEach.call($('nav').querySelectorAll('.navitem'), function(a){
      a.classList.toggle('active', a.getAttribute('data-sec')===id);
    });
    // 窄屏下底栏横向滚动：把当前标签滚到可见位置（否则它可能被截在滚动区外）。
    try{ var navEl=$('nav'); var actEl=navEl && navEl.querySelector('.navitem.active');
      if(navEl && actEl) navEl.scrollLeft = actEl.offsetLeft - navEl.clientWidth/2 + actEl.offsetWidth/2; }catch(e){}
    if(location.hash!=='#'+id) { try{ history.replaceState(null,'','#'+id); }catch(e){} }
    try{ window.scrollTo(0,0); }catch(e){} // 切页后回到顶部：移动端底栏点标签，看到的应是新页面的顶部
    onSectionEnter(id);
  }
  // Back/forward + manual hash edits switch sections.
  window.addEventListener('hashchange', function(){
    var id=location.hash.replace(/^#/,''); if(id && navIds.indexOf(id)>=0) selectSection(id);
  });
  function onSectionEnter(id){
    if(id==='models' || id==='docs'){
      // 先用兜底模型立刻填文档示例框（不等 /v1/models 回来，避免框里长时间空白），
      // 模型列表回来后再按真实首个模型重填一次。
      if(id==='docs') fillDocs();
      loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); fillDocs(); var mu=$('models-updated'); if(mu) mu.textContent=modelsFetchedAt?'更新于 '+fmtDate(modelsFetchedAt):''; });
      var mrf=$('models-refresh'); if(mrf) mrf.onclick=function(){ mrf.disabled=true; loadModels().then(function(){ renderModelsInto('models-body'); var mu=$('models-updated'); if(mu) mu.textContent=modelsFetchedAt?'更新于 '+fmtDate(modelsFetchedAt):''; mrf.disabled=false; }); };
    }
    if(id==='modelstats') initModelStats();
    if(id==='dashboard') loadModels().then(loadDashboard);
    if(id==='tokens'){ var mo=$('my-mint-out'); if(mo){ mo.style.display='none'; mo.innerHTML=''; } loadMyTokens(); }
    if(id==='overview') loadStats('ov');
    if(id==='keys'){ loadStats('keys'); loadModelStatus(); loadPoolCustomKeys(); }
    if(id==='keylist'){ var rb=$('keylist-refresh'); if(rb) rb.onclick=loadKeyList; var cb=$('keylist-checkall'); if(cb) cb.onclick=checkAllKeys; var tg=$('keylist-toggle'); if(tg) tg.onclick=function(){ keylistShowDisabled=!keylistShowDisabled; loadKeyList(); }; var pr=$('keylist-prune'); if(pr) pr.onclick=function(){ if(!confirm('清理所有永久失效的 key?欠费的会保留')) return; pr.disabled=true; var out=$('keylist-checkall-out'); if(out) out.textContent='清理中…'; api('/admin/keys/prune',{method:'POST'}).then(function(r){ pr.disabled=false; if(out) out.textContent='已清理 '+((r.body&&r.body.removed)||0)+' 个失效 key'; loadKeyList(); }).catch(function(){ pr.disabled=false; if(out) out.textContent='清理出错'; }); }; loadKeyList(); }
    if(id==='users') loadUsers();
    if(id==='admintokens') loadAdminTokens();
    if(id==='aliases') loadAliases();
    if(id==='usage'){ var ur=$('usage-refresh'); if(ur) ur.onclick=loadUserUsage; loadUserUsage(); }
    if(id==='logs'){
      var lr=$('logs-refresh'); if(lr) lr.onclick=loadAdminUsage;
      var rr=$('rank-refresh'); if(rr) rr.onclick=loadAdminRank;
      var su=$('logs-user'); if(su) su.onchange=function(){ logsOwner=su.value; logsPage=0; loadAdminUsage(); };
      var pv=$('logs-prev'); if(pv) pv.onclick=function(){ if(logsPage>0){ logsPage--; loadAdminLogs(); } };
      var nx=$('logs-next'); if(nx) nx.onclick=function(){ logsPage++; loadAdminLogs(); };
      loadAdminUsage();
    }
    if(id==='billing') loadBilling();
    if(id==='balance') loadBalance();
    if(id==='chat') initChat();
    if(id==='debugchat') initDbgChat();
  }

  // ---------------- chat playgrounds ----------------
  function renderChat(logId, msgs){
    var el=$(logId); if(!el) return;
    if(!msgs.length){ el.innerHTML='<span style="color:var(--faint)">开始对话…</span>'; return; }
    el.innerHTML = msgs.map(function(m){
      var who = m.role==='user'?'你':(m.role==='assistant'?'AI':m.role);
      var col = m.role==='user'?'var(--blue)':'var(--green)';
      var note = m.note ? '<div style="font-size:12px;color:var(--amber);margin-top:2px">⤷ '+esc(m.note)+'</div>' : '';
      var raw = String(m.content==null?'':m.content);
      var body = (m.role==='assistant' && raw==='') ? '<span style="color:var(--faint)">▍…</span>' : esc(raw);
      return '<div style="margin-bottom:11px"><b style="font-family:var(--marker);color:'+col+'">'+who+'</b>'+note
        +'<div style="white-space:pre-wrap;word-break:break-word">'+body+'</div></div>';
    }).join('');
    el.scrollTop = el.scrollHeight;
  }
  function chatReply(r){
    if(r.ok && r.body && r.body.choices && r.body.choices[0] && r.body.choices[0].message)
      return r.body.choices[0].message.content;
    var e = r.body && (r.body.error && r.body.error.message || r.body.error) || JSON.stringify(r.body);
    return '⚠ [错误 '+r.status+'] '+e;
  }
  function bindEnter(inputId, sendFn){
    var el=$(inputId); if(!el||el.__b) return; el.__b=1;
    el.addEventListener('keydown', function(ev){ if(ev.isComposing || ev.keyCode===229) return; if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); sendFn(); } });
  }
  // streaming chat: append an assistant bubble that fills in as SSE arrives.
  function streamChat(path, payload, logId, msgs, btn){
    var asst={role:'assistant',content:''};
    var usage=null, provider='';
    msgs.push(asst); renderChat(logId, msgs);
    payload.stream=true;
    payload.stream_options={include_usage:true};
    function fail(s,t){
      var j=null; try{j=JSON.parse(t);}catch(e){}
      if(s===402){
        // Consumer chat: 402 means the caller's gateway balance ran out —
        // send them to top up. Admin debug chat: the /admin/keys/:id/chat
        // endpoint bypasses billing, so a 402 here is the UPSTREAM key's
        // own balance (e.g. a 0-credit OpenRouter account); gateway top-up
        // can't fix that, and there is no 'balance' section in the admin
        // nav (selectSection would silently fall back to overview).
        var isAdmin = me && me.role==='admin';
        asst.content=isAdmin ? '上游 key 余额不足(该供应商账号没钱了),请给供应商账号充值或换个免费模型' : '余额不足,请先充值'; renderChat(logId,msgs);
        var lg=$(logId);
        if(lg && !isAdmin){ var bt=document.createElement('button'); bt.className='btn primary small'; bt.textContent='去充值'; bt.style.marginTop='6px'; bt.onclick=function(){ selectSection('balance'); }; lg.appendChild(bt); lg.scrollTop=lg.scrollHeight; }
        if(btn){ btn.disabled=false; btn.textContent='发送'; }
        return;
      }
      asst.content='⚠ [错误 '+s+'] '+((j&&j.error&&(j.error.message||j.error))||t||''); renderChat(logId,msgs); if(btn){ btn.disabled=false; btn.textContent='发送'; }
    }
    fetch(base+path,{method:'POST',headers:(function(){ var h={'content-type':'application/json'}; try{ var tk=localStorage.getItem('kp_token'); if(tk) h['Authorization']='Bearer '+tk; }catch(e){} return h; })(),credentials:'same-origin',body:JSON.stringify(payload)})
    .then(function(resp){
      if(!resp.ok || !resp.body){ return resp.text().then(function(t){ fail(resp.status,t); }); }
      // If the gateway fell back to a different model, label the reply honestly.
      if(resp.headers.get('X-KeyPool-Fallback')){
        var actual=resp.headers.get('X-KeyPool-Model')||'';
        if(actual && actual!==(payload.model||'')) asst.note='所选模型暂不可用,已自动改用 '+actual;
      }
      provider=resp.headers.get('X-KeyPool-Provider')||'';
      var reader=resp.body.getReader(), dec=new TextDecoder(), buf='';
      (function pump(){
        return reader.read().then(function(res){
          if(res.done){
            if(!asst.content) asst.content='(无内容)';
            if(usage){ var ntk=(usage.total_tokens!=null)?usage.total_tokens:((usage.prompt_tokens||0)+(usage.completion_tokens||0)); var un='本次 ~'+ntk+' tokens'+(provider?' · '+provider:''); asst.note=asst.note?asst.note+' · '+un:un; }
            renderChat(logId,msgs); refreshChatBalance(); if(btn){ btn.disabled=false; btn.textContent='发送'; } return;
          }
          buf+=dec.decode(res.value,{stream:true});
          var parts=buf.split('\n'); buf=parts.pop();
          parts.forEach(function(line){
            line=line.trim(); if(line.indexOf('data:')!==0) return;
            var data=line.slice(5).trim(); if(!data||data==='[DONE]') return;
            try{ var o=JSON.parse(data); if(o&&o.usage) usage=o.usage; var d=o.choices&&o.choices[0]&&o.choices[0].delta; if(d&&typeof d.content==='string') asst.content+=d.content; }catch(e){}
          });
          renderChat(logId,msgs);
          return pump();
        });
      })().catch(function(){
        // A read error mid-stream (network drop, aborted body) used to leave
        // the button stuck on "发送中…" with no error shown.
        asst.content=asst.content||'⚠ 流中断,请重试';
        renderChat(logId,msgs); if(btn){ btn.disabled=false; btn.textContent='发送'; }
      });
    }).catch(function(){ asst.content=asst.content||'⚠ 网络错误'; renderChat(logId,msgs); if(btn){ btn.disabled=false; btn.textContent='发送'; } });
  }
  // consumer chat (billed)
  var chatMsgs=[];
  // Friendly Chinese descriptions so tier-alias model ids (qwen-max etc.) are legible.
  var MODEL_LABELS={
    'mistral-large-latest':'Mistral 旗舰','mistral-small-latest':'Mistral 轻量','open-mistral-nemo':'Mistral Nemo 开源','codestral-latest':'Mistral 代码',
    'moonshot-v1-8k':'Kimi 8K 上下文','moonshot-v1-32k':'Kimi 32K 上下文','moonshot-v1-128k':'Kimi 128K 长文','kimi-k2-0711-preview':'Kimi K2 预览',
    'glm-4-flash':'智谱 GLM-4 Flash(免费)','glm-4-plus':'智谱 GLM-4 Plus','glm-4-air':'智谱 GLM-4 Air','glm-4':'智谱 GLM-4',
    'qwen-max':'通义千问 Max(最强)','qwen-plus':'通义千问 Plus(均衡)','qwen-turbo':'通义千问 Turbo(快/省)','qwen2.5-72b-instruct':'通义千问 2.5 72B',
    'gemini-2.0-flash':'Gemini 2.0 Flash','gemini-2.0-flash-lite':'Gemini 2.0 Flash Lite','gemini-1.5-flash':'Gemini 1.5 Flash','gemini-1.5-pro':'Gemini 1.5 Pro',
    'gpt-4o':'OpenAI GPT-4o','gpt-4o-mini':'OpenAI GPT-4o mini','o3-mini':'OpenAI o3-mini',
    'deepseek-chat':'DeepSeek V3 对话','deepseek-reasoner':'DeepSeek R1 推理',
    'llama-3.3-70b-versatile':'Llama 3.3 70B (Groq)','llama-3.1-8b-instant':'Llama 3.1 8B (Groq)'
  };
  function modelLabel(id){ var d=MODEL_LABELS[id]; return d ? id+' — '+d : id; }
  function initChat(){
    loadModels().then(function(){
      var sel=$('chat-model'); var b=$('chat-send'); var inp=$('chat-input');
      var none=(modelsCache||[]).length===0;
      if(none){
        if(!chatMsgs.length) renderChat('chat-log', chatMsgs);
        $('chat-log').innerHTML='<span style="color:var(--faint)">// '+(modelsErr?'模型列表加载失败,稍后再试':'暂无可用模型,稍后再试')+'</span>';
        if(b) b.disabled=true; if(inp) inp.disabled=true;
        return;
      }
      if(b) b.disabled=false; if(inp) inp.disabled=false;
      // Refill the dropdown every time the chat view opens (no
      // options.length guard): new models/keys added since the last
      // visit would otherwise never appear until a full reload.
      if(sel){
        var groups={};
        (modelsCache||[]).forEach(function(m){ (groups[m.owned_by]=groups[m.owned_by]||[]).push(m.id); });
        sel.innerHTML = Object.keys(groups).map(function(p){
          return '<optgroup label="'+esc(p)+'">'+groups[p].map(function(id){return '<option value="'+esc(id)+'">'+esc(modelLabel(id))+'</option>';}).join('')+'</optgroup>';
        }).join('');
      }
    });
    var b=$('chat-send'); if(b) b.onclick=sendChat; refreshChatBalance();
    var cl=$('chat-clear'); if(cl) cl.onclick=function(){ chatMsgs=[]; renderChat('chat-log',chatMsgs); };
    bindEnter('chat-input', sendChat);
  }
  function refreshChatBalance(){
    var el=$('chat-bal-usd'); if(!el) return;
    api('/me/balance').then(function(r){
      if(!(r.ok && r.body && r.body.balance_micro!=null)){ el.innerHTML='<span class="e">读取失败</span>'; return; }
      var bal=r.body.balance_micro; el.textContent=usd(bal); el.style.color = bal<=0 ? 'var(--red)' : '';
    }).catch(function(){ el.textContent='–'; });
  }
  function sendChat(){
    var inp=$('chat-input'), txt=inp.value.trim(); if(!txt) return;
    var model=$('chat-model').value; if(!model) return;
    chatMsgs.push({role:'user',content:txt}); inp.value='';
    var btn=$('chat-send'); btn.disabled=true; btn.textContent='发送中…';
    streamChat('/v1/chat/completions', {model:model, messages:chatMsgs.slice()}, 'chat-log', chatMsgs, btn);
  }
  // admin debug chat (specific key, no billing)
  var dbgMsgs=[]; var dbgKeys=[]; // cache full key rows so key→provider + health are known
  var dbgModelStatus=[]; // model_status rows: added models stay listed here even when the key is disabled/cooldown (pool /v1/models hides them then), so the debug picker still offers them
  function initDbgChat(){
    var sel=$('dbg-key'); var prev=sel?sel.value:'';
    Promise.all([loadModels(), api('/admin/models-status').then(function(r){ if(r.ok && Array.isArray(r.body)) dbgModelStatus=r.body; })]).then(function(){ return api('/admin/keys/list'); }).then(function(r){
      if(!sel) return;
      if(!r.ok){ $('dbg-log').innerHTML='<span style="color:var(--faint)">// 拉取 key 列表失败,稍后重试</span>'; return; }
      var keys=(r.body&&r.body.keys)||[];
      var b=$('dbg-send');
      if(!keys.length){ $('dbg-log').innerHTML='<span style="color:var(--faint)">// 池子里还没有 key,先去「Key 池」添加</span>'; if(b) b.disabled=true; return; }
      if(b) b.disabled=false;
      dbgKeys=keys; // cache full rows so key→provider + health strip work without a re-fetch
      sel.innerHTML = keys.map(function(k){ var p=(k.provider==='custom'&&k.service_slug)?k.service_slug:k.provider; return '<option value="'+k.id+'">#'+k.id+' · '+p+' · '+esc(k.masked)+' ('+k.status+')</option>'; }).join('');
      if(prev) sel.value=prev; // keep the operator's selection across section re-entry
      sel.onchange=onDbgKeyChange;
      onDbgKeyChange(); // fill the model picker + health strip for the current key
    });
    var b=$('dbg-send'); if(b) b.onclick=sendDbg;
    var cl=$('dbg-clear'); if(cl) cl.onclick=function(){ dbgMsgs=[]; renderChat('dbg-log',dbgMsgs); };
    bindEnter('dbg-input', sendDbg);
  }
  function dbgKeyById(id){ for(var i=0;i<dbgKeys.length;i++){ if(String(dbgKeys[i].id)===String(id)) return dbgKeys[i]; } return null; }
  function onDbgKeyChange(){
    var k=dbgKeyById($('dbg-key').value);
    var ms=$('dbg-model');
    if(ms){
      // Offer every model this key's provider can serve: the pool list
      // (/v1/models) plus models added via the key list (model_status) —
      // the latter survive even when the key is disabled and the pool
      // hides the provider, which is exactly when you're debugging it.
      var seen={}, opts=[];
      (modelsCache||[]).forEach(function(m){ if(k && (m.owned_by||m.ownedBy)===k.provider && !seen[m.id]){ seen[m.id]=1; opts.push(m.id); } });
      (dbgModelStatus||[]).forEach(function(m){ if(k && m.provider===k.provider && m.available && !seen[m.model]){ seen[m.model]=1; opts.push(m.model); } });
      ms.innerHTML='<option value="">默认</option>'+opts.map(function(id){ return '<option value="'+esc(id)+'">'+esc(modelLabel(id))+'</option>'; }).join('');
    }
    renderDbgHealth(k);
  }
  function renderDbgHealth(k){
    var h=$('dbg-health'); if(!h) return;
    if(!k){ h.style.display='none'; h.innerHTML=''; return; }
    var sd = k.status==='disabled' ? 'd-disabled'
           : k.status==='cooldown' ? 'd-cooldown'
           : k.last_error ? 'd-warn'
           : 'd-active';
    var label = sd==='d-disabled'?'已禁用':sd==='d-cooldown'?'冷却中':sd==='d-warn'?'异常(仍在用)':'可用';
    var reason = (k.status==='disabled' && k.disabled_reason) ? k.disabled_reason : k.last_error;
    var bits='<span class="dot '+sd+'" style="margin-right:5px"></span>'+label;
    if(reason) bits+=' · '+esc(String(reason).slice(0,80));
    if(k.cooldown_until) bits+=' · 冷却至 '+esc(fmtDate(k.cooldown_until));
    h.style.display=''; h.innerHTML=bits;
  }
  function sendDbg(){
    var inp=$('dbg-input'), txt=inp.value.trim(); if(!txt) return;
    var id=$('dbg-key').value; if(!id){ $('dbg-log').innerHTML='<span style="color:var(--faint)">先在上方选一个 key</span>'; return; }
    var model=$('dbg-model').value;
    var mt=parseInt(($('dbg-maxtok').value||'').trim(),10);
    dbgMsgs.push({role:'user',content:txt}); inp.value='';
    var btn=$('dbg-send'); btn.disabled=true;
    var payload={messages:dbgMsgs.slice()}; if(model) payload.model=model;
    if(mt>0) payload.max_tokens=mt; // route defaults to 256 — let the operator raise the cap
    streamChat('/admin/keys/'+id+'/chat', payload, 'dbg-log', dbgMsgs, btn);
  }

  // ---------------- usage / logs (shared renderers) ----------------
  function pct(ok,n){ return n>0 ? Math.round(ok/n*100)+'%' : '–'; }
  function renderUsage(d, p){
    $(p+'-total').textContent = fmtNum(d.total||0);
    $(p+'-rate').textContent = pct(d.ok||0, d.total||0);
    $(p+'-tokens').textContent = fmtNum(d.tokens||0);
    var rows=(d.byProvider||[]).map(function(x){
      return '<tr><td style="font-weight:700">'+esc(x.provider)+'</td><td class="n">'+fmtNum(x.n)+'</td>'
        +'<td class="n">'+fmtNum(x.ok)+'</td><td class="n">'+Math.round(x.avg_latency||0)+'ms</td>'
        +'<td class="n">'+fmtNum(x.tokens||0)+'</td></tr>';
    }).join('');
    $(p+'-byprov').innerHTML = rows || '<tr><td colspan="5" style="color:var(--faint)">暂无</td></tr>';
  }
  function renderRecent(rows, tbodyId, showOwner){
    var cols = showOwner ? 7 : 6;
    var html=(rows||[]).map(function(r){
      var t=fmtDate(r.created_at);
      var okc=r.ok?'var(--green)':'var(--red)';
      var owner='';
      if(showOwner){
        // admin view: who sent it. owner_sub NULL = an admin-minted token (no user).
        var who = r.owner_email || r.owner_name || (r.owner_sub ? ('…'+String(r.owner_sub).slice(-6)) : '管理员令牌');
        var full = r.owner_email || r.owner_name || r.owner_sub || '管理员令牌';
        owner='<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(String(full))+'">'+esc(String(who))+'</td>';
      }
      return '<tr><td style="color:var(--faint)">'+t+'</td>'+owner+'<td>'+esc(r.provider)+'</td>'
        +'<td>'+esc(r.model||'–')+'</td><td style="color:'+okc+'">'+(r.status_code==null?'–':r.status_code)+'</td>'
        +'<td class="n">'+(r.latency_ms==null?'–':r.latency_ms+'ms')+'</td>'
        +'<td class="n">'+(r.total_tokens==null?'–':fmtNum(r.total_tokens))+'</td></tr>';
    }).join('');
    $(tbodyId).innerHTML = html || '<tr><td colspan="'+cols+'" style="color:var(--faint)">暂无</td></tr>';
  }
  // Inline SVG daily bar chart: last 14 days (byDay is newest-first), drawn
  // oldest->newest, ok in green stacked under failures in the red accent.
  function renderDayChart(containerId, byDay){
    var el=$(containerId); if(!el) return;
    var days=(Array.isArray(byDay)?byDay:[]).slice(0,14).reverse(); // oldest -> newest
    if(!days.length){ el.innerHTML='<div class="hint" style="margin:0">暂无每日数据</div>'; return; }
    var slot=34, bw=22, H=128, base=H-22, top=18;
    var W=days.length*slot+10;
    var max=1; days.forEach(function(d){ var n=d.n||0; if(n>max) max=n; });
    var bars=days.map(function(d,i){
      var n=d.n||0, ok=d.ok||0, fail=n-ok; if(fail<0) fail=0;
      var x=5+i*slot;
      var hN=Math.round((n/max)*(base-top));
      var hFail=Math.round((fail/max)*(base-top));
      var hOk=hN-hFail; if(hOk<0) hOk=0;
      var yTop=base-hN;
      var label=String(d.day||'').slice(5); // MM-DD
      var g='';
      if(hFail>0) g+='<rect x="'+x+'" y="'+yTop+'" width="'+bw+'" height="'+hFail+'" fill="var(--red)" stroke="var(--ink)" stroke-width="1.5" rx="2"/>';
      if(hOk>0) g+='<rect x="'+x+'" y="'+(yTop+hFail)+'" width="'+bw+'" height="'+hOk+'" fill="var(--green)" stroke="var(--ink)" stroke-width="1.5" rx="2"/>';
      if(n>0) g+='<text x="'+(x+bw/2)+'" y="'+(yTop-3)+'" text-anchor="middle" font-size="9" fill="var(--muted)" font-family="ui-monospace,monospace">'+esc(String(n))+'</text>';
      g+='<text x="'+(x+bw/2)+'" y="'+(H-7)+'" text-anchor="middle" font-size="8.5" fill="var(--faint)" font-family="ui-monospace,monospace">'+esc(label)+'</text>';
      return g;
    }).join('');
    var sumN=0, sumOk=0; days.forEach(function(d){ sumN+=(d.n||0); sumOk+=(d.ok||0); });
    var aria='近 '+days.length+' 天共 '+sumN+' 次请求,成功 '+sumOk+' 次';
    // Fixed display height; width derives from the viewBox so a 2-day chart
    // stays small instead of being scaled up to fill the whole card.
    el.innerHTML='<svg role="img" aria-label="'+esc(aria)+'" height="150" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMinYMid meet" style="max-width:100%;display:block">'
      +'<line x1="5" y1="'+base+'" x2="'+(W-5)+'" y2="'+base+'" stroke="var(--ink)" stroke-width="1.5"/>'
      +bars+'</svg>';
  }
  function loadUserUsage(){
    ['u-total','u-rate','u-tokens'].forEach(function(i){ if($(i)) $(i).textContent='…'; });
    // Onboarding CTA fires only when we positively know both usage total and
    // logs are empty (0/0). On any API failure these stay null, so the error
    // states below are never masked by a fake empty state.
    var uTotal=null, uLogs=null;
    function maybeOnboard(){
      if(uTotal!==0 || uLogs!==0) return;
      $('u-byprov').innerHTML='<tr><td colspan="5" style="color:var(--muted);padding:16px 10px;line-height:1.7">还没有调用记录 · 先到「令牌」创建一个令牌并发起第一次请求<br>'
        +'<button class="btn ghost small" id="u-onboard-go" style="margin-top:8px">去创建令牌</button></td></tr>';
      var go=$('u-onboard-go'); if(go) go.onclick=function(){ selectSection('tokens'); };
    }
    api('/me/usage').then(function(r){
      if(r.ok){ renderUsage(r.body,'u'); renderDayChart('u-chart', r.body&&r.body.byDay); uTotal=(r.body&&r.body.total)||0; maybeOnboard(); return; }
      ['u-total','u-rate','u-tokens'].forEach(function(i){ if($(i)) $(i).textContent='–'; });
      $('u-byprov').innerHTML='<tr><td colspan="5"><span class="e">加载失败</span> · <button class="btn ghost small" id="u-usage-retry">重试</button></td></tr>';
      var rb=$('u-usage-retry'); if(rb) rb.onclick=loadUserUsage;
    }).catch(function(){ ['u-total','u-rate','u-tokens'].forEach(function(i){ if($(i)) $(i).textContent='–'; }); });
    api('/me/logs').then(function(r){
      if(r.ok){ var lg=Array.isArray(r.body)?r.body:[]; renderRecent(lg, 'u-recent'); uLogs=lg.length; maybeOnboard(); return; }
      $('u-recent').innerHTML='<tr><td colspan="6" style="color:var(--red)">加载失败,点此重试</td></tr>';
      var c=$('u-recent').querySelector('td'); if(c) c.onclick=loadUserUsage;
    });
  }
  // admin logs view state: owner filter (owner_sub, '' = all) + zero-based page.
  var logsOwner='';
  var logsPage=0;
  function fmtUser(o){
    return o.owner_email || o.owner_name || (o.owner_sub ? ('…'+String(o.owner_sub).slice(-6)) : '管理员令牌');
  }
  function loadAdminLogs(){
    var q='?page='+logsPage+'&size=50'+(logsOwner?('&owner='+encodeURIComponent(logsOwner)):'');
    return api('/admin/logs'+q).then(function(r){
      if(!r.ok){
        var pg=$('logs-page'); if(pg) pg.textContent='加载失败 · 错误 '+r.status;
        return;
      }
      var b=r.body||{}; var rows=b.rows||[];
      renderRecent(rows,'l-recent',true);
      var pg=$('logs-page'); if(pg) pg.textContent='第 '+(logsPage+1)+' 页';
      var pv=$('logs-prev'); if(pv) pv.disabled = logsPage<=0;
      var nx=$('logs-next'); if(nx) nx.disabled = !b.hasMore;
    });
  }
  function loadAdminRank(){
    return api('/admin/usage/by-user').then(function(r){
      if(!r.ok) return;
      var rows=Array.isArray(r.body)?r.body:[];
      var tb=$('l-rank'); if(!tb) return;
      if(!rows.length){ tb.innerHTML='<tr><td colspan="6" style="color:var(--faint)">暂无</td></tr>'; return; }
      tb.innerHTML=rows.map(function(u,i){
        var rate=u.n>0?Math.round(u.ok/u.n*100)+'%':'–';
        var last=u.last_at?fmtDate(u.last_at):'–';
        var full=u.owner_email||u.owner_name||u.owner_sub||'管理员令牌';
        return '<tr data-sub="'+esc(String(u.owner_sub||''))+'" style="cursor:pointer">'
          +'<td class="n">'+(i+1)+'</td>'
          +'<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(String(full))+'">'+esc(fmtUser(u))+'</td>'
          +'<td class="n">'+u.n+'</td><td class="n">'+rate+'</td>'
          +'<td class="n">'+(u.tokens||0)+'</td>'
          +'<td style="color:var(--faint)">'+last+'</td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('tr[data-sub]'),function(tr){
        tr.onclick=function(){
          logsOwner=tr.getAttribute('data-sub'); logsPage=0;
          var sel=$('logs-user'); if(sel) sel.value=logsOwner;
          loadAdminUsage();
        };
      });
    });
  }
  function loadAdminUsers(){
    var sel=$('logs-user'); if(!sel||sel.__filled) return;
    api('/admin/users').then(function(r){
      if(!r.ok) return;
      var users=Array.isArray(r.body)?r.body:[];
      var opts='<option value="">全部用户</option>';
      users.forEach(function(u){
        var label=u.email||u.name||('…'+String(u.sub).slice(-6));
        opts+='<option value="'+esc(String(u.sub))+'">'+esc(label)+'</option>';
      });
      sel.innerHTML=opts; sel.__filled=true; sel.value=logsOwner;
    });
  }
  function loadAdminUsage(){
    var oq=logsOwner?('?owner='+encodeURIComponent(logsOwner)):'';
    api('/admin/usage'+oq).then(function(r){ if(r.ok){ renderUsage(r.body,'l'); renderDayChart('l-chart', r.body&&r.body.byDay); } });
    loadAdminLogs();
    loadAdminRank();
    loadAdminUsers();
  }

  // ---------------- billing / balance (money in micro-USD) ----------------
  function usd(micro){ return ((micro==null?0:micro)/1000000).toFixed(4); }
  function usd2(micro){ return ((micro==null?0:micro)/1000000).toFixed(2); }
  // micro precision (6dp) for the ledger — cheap models charge 1 micro-USD per
  // request, which toFixed(4) would render as a misleading 0.0000.
  function usd6(micro){ return ((micro==null?0:micro)/1000000).toFixed(6); }
  function txnRow(t, withSub){
    var time=fmtDate(t.created_at);
    var amtc=(t.kind==='topup')?'var(--green)':'var(--red)';
    var sign=(t.kind==='topup')?'+':'-';
    var cells='<td style="color:var(--faint)">'+esc(time)+'</td>';
    if(withSub){
      // show WHO consumed (email/name); fall back to the sub suffix; admin-minted = 管理员令牌
      var who = t.owner_email || t.owner_name || (t.sub ? ('…'+String(t.sub).slice(-6)) : '管理员令牌');
      var full = t.owner_email || t.owner_name || t.sub || '管理员令牌';
      cells+='<td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(String(full))+'">'+esc(String(who))+'</td>';
    }
    cells+='<td>'+esc(KIND_ZH[t.kind]||t.kind)+'</td>'
      +'<td class="n" style="color:'+amtc+'">'+sign+usd6(Math.abs(t.amount_micro))+'</td>'
      +'<td class="n">'+usd6(t.balance_after_micro)+'</td>'
      +'<td>'+esc(t.model||'–')+'</td>'
      +'<td class="n">'+(t.tokens==null?'–':t.tokens)+'</td>'
      +'<td style="color:var(--faint)">'+esc(t.note||'–')+(t.estimated?' <span class="badge" title="上游未回报用量,按上限预估">预估</span>':'')+'</td>';
    return '<tr>'+cells+'</tr>';
  }

  // ---------------- admin: billing ----------------
  function loadBilling(){
    loadBalances(); loadBillingTxns(); loadPrices(); loadBillTxnsUsers();
    api('/admin/config').then(function(r){ if(!r.ok) return; var b=r.body||{};
      var zhe = b.discount!=null ? (b.discount*10) : 10;
      $('bill-config').innerHTML = '· 计费'+(b.billing_enabled?'<b style="color:var(--green)">开</b>':'<b style="color:var(--red)">关</b>')+' · 折扣 <b>'+zhe+'折</b>(市场价×'+(b.discount!=null?b.discount:1)+')';
    });
  }
  function loadBalances(){
    var tb=$('bill-balances-body');
    return api('/admin/balances').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="4" class="e">错误 '+r.status+'</td></tr>'; ['bal-sum','bal-users','bal-paid'].forEach(function(i){ if($(i)) $(i).textContent='–'; }); return; }
      var list=Array.isArray(r.body)?r.body:[];
      var bsum=0,bpaid=0; list.forEach(function(b){ var m=b.balance_micro||0; bsum+=m; if(m>0)bpaid++; });
      if($('bal-sum')) $('bal-sum').textContent=usd(bsum);
      if($('bal-users')) $('bal-users').textContent=list.length;
      if($('bal-paid')) $('bal-paid').textContent=bpaid;
      if(!list.length){ tb.innerHTML='<tr><td colspan="4" style="color:var(--faint)">暂无</td></tr>'; return; }
      tb.innerHTML=list.map(function(b){
        return '<tr><td style="font-weight:700; word-break:break-all">'+esc(b.email||'–')+'</td>'
          +'<td style="font-family:ui-monospace,monospace;font-size:12px">'+esc(String(b.sub||'').slice(0,16))+'</td>'
          +'<td class="n">'+usd(b.balance_micro)+'</td>'
          +'<td><button class="btn ghost small" data-fillsub="'+esc(b.sub)+'">充值</button></td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-fillsub]'), function(btn){
        btn.onclick=function(){ $('bill-sub').value=btn.getAttribute('data-fillsub'); $('bill-amount').focus(); };
      });
    }).catch(function(){ tb.innerHTML='<tr><td colspan="4" class="e">出错</td></tr>'; ['bal-sum','bal-users','bal-paid'].forEach(function(i){ if($(i)) $(i).textContent='–'; }); });
  }
  function loadBillingTxns(){
    var tb=$('bill-txns-body');
    var sel=$('bill-txns-user'); var owner=sel?sel.value:'';
    var q=owner?('?owner='+encodeURIComponent(owner)):'';
    return api('/admin/transactions'+q).then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="8" class="e">加载失败 · 错误 '+r.status+'</td></tr>'; return; }
      var list=Array.isArray(r.body)?r.body:[];
      if(!list.length){ tb.innerHTML='<tr><td colspan="8" style="color:var(--faint)">暂无</td></tr>'; return; }
      tb.innerHTML=list.map(function(t){ return txnRow(t, true); }).join('');
    }).catch(function(){ tb.innerHTML='<tr><td colspan="8" class="e">出错</td></tr>'; });
  }
  // populate the 最近流水 user filter once, from the balances list (has email+sub)
  function loadBillTxnsUsers(){
    var sel=$('bill-txns-user'); if(!sel||sel.__filled) return;
    api('/admin/balances').then(function(r){
      if(!r.ok) return;
      var list=Array.isArray(r.body)?r.body:[];
      var opts='<option value="">全部用户</option>';
      list.forEach(function(b){ if(!b.sub) return; var label=b.email||('…'+String(b.sub).slice(-6)); opts+='<option value="'+esc(String(b.sub))+'">'+esc(label)+'</option>'; });
      sel.innerHTML=opts; sel.__filled=true;
    });
  }
  function topUp(){
    var sub=$('bill-sub').value.trim();
    var amount=parseFloat($('bill-amount').value);
    var note=$('bill-note').value.trim();
    var o=$('bill-topup-out'); o.style.display='block';
    if(!sub || !(amount>0)){ o.innerHTML='<span class="e">请填写有效的 sub 和金额</span>'; return; }
    if(!confirm('确认为 '+sub.slice(0,16)+' 充值 '+amount+' USD？')){ o.style.display='none'; return; }
    var btn=$('bill-topup'); btn.disabled=true;
    var payload={amount_usd:amount}; if(note) payload.note=note;
    api('/admin/balances/'+encodeURIComponent(sub)+'/topup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){ btn.disabled=false;
      if(!r.ok){ var msg=(r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status); o.innerHTML='<span class="e">'+esc(msg)+'</span>'; return; }
      var bal=(r.body&&r.body.balance_micro);
      o.innerHTML='<span class="k">充值成功</span> 新余额 '+usd(bal)+' USD';
      $('bill-amount').value=''; $('bill-note').value='';
      loadBalances(); loadBillingTxns();
    }).catch(function(){ btn.disabled=false; o.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- admin: model prices ----------------
  function priceUsd(micro){ return ((micro==null?0:micro)/1000000).toFixed(4); }
  function loadPrices(){
    var tb=$('prices-body');
    return api('/admin/prices').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="4" class="e">加载失败 · 错误 '+r.status+'</td></tr>'; return; }
      var list=Array.isArray(r.body)?r.body:((r.body&&r.body.prices)||[]);
      if(!Array.isArray(list)||!list.length){ tb.innerHTML='<tr><td colspan="4" style="color:var(--faint)">暂无</td></tr>'; return; }
      tb.innerHTML=list.map(function(p){
        var inp=p.input_per_mtok_micro!=null?p.input_per_mtok_micro:p.price_per_mtok_micro;
        var out=p.output_per_mtok_micro!=null?p.output_per_mtok_micro:p.price_per_mtok_micro;
        return '<tr><td style="font-weight:700" class="mono-token">'+esc(p.model)+'</td>'
          +'<td class="n">'+priceUsd(inp)+'</td>'
          +'<td class="n">'+priceUsd(out)+'</td>'
          +'<td><button class="btn ghost small" data-editprice="'+esc(p.model)+'" data-pin="'+esc(priceUsd(inp))+'" data-pout="'+esc(priceUsd(out))+'">编辑</button></td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-editprice]'), function(btn){
        btn.onclick=function(){
          $('price-model').value=btn.getAttribute('data-editprice');
          $('price-input').value=btn.getAttribute('data-pin');
          $('price-output').value=btn.getAttribute('data-pout');
          $('price-model').focus();
        };
      });
    }).catch(function(){ tb.innerHTML='<tr><td colspan="4" class="e">出错</td></tr>'; });
  }
  function savePrice(){
    var model=$('price-model').value.trim();
    var inUsd=parseFloat($('price-input').value);
    var outUsd=parseFloat($('price-output').value);
    var o=$('price-out'); o.style.display='block';
    if(!model || !(inUsd>=0) || !(outUsd>=0)){ o.innerHTML='<span class="e">请填写模型与有效价格</span>'; return; }
    var btn=$('price-save'); btn.disabled=true;
    var payload={ model:model, input_per_mtok_micro:Math.round(inUsd*1000000), output_per_mtok_micro:Math.round(outUsd*1000000) };
    api('/admin/prices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){ btn.disabled=false;
      if(!r.ok){ var msg=(r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status); o.innerHTML='<span class="e">'+esc(msg)+'</span>'; return; }
      o.innerHTML='<span class="k">已保存</span> '+esc(model);
      $('price-model').value=''; $('price-input').value=''; $('price-output').value='';
      loadPrices();
    }).catch(function(){ btn.disabled=false; o.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- consumer: top-up via Stripe ----------------
  function checkout(){
    var amount=parseFloat($('bal-topup-amount').value);
    var o=$('bal-topup-out'); o.style.display='block';
    if(!(amount>0)){ o.innerHTML='<span class="e">请填写有效金额</span>'; return; }
    if(amount<1){ o.innerHTML='<span class="e">最低 1 USD</span>'; return; }
    var btn=$('bal-topup-btn'); btn.disabled=true;
    api('/me/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount_usd:amount})})
    .then(function(r){ btn.disabled=false;
      if(r.status===503){ o.innerHTML='<span class="e">支付未配置</span>'; return; }
      if(r.ok && r.body && r.body.url){ location.href=r.body.url; return; }
      var msg=(r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status); o.innerHTML='<span class="e">'+esc(msg)+'</span>';
    }).catch(function(){ btn.disabled=false; o.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- consumer: balance ----------------
  function loadBalance(){
    var rb=$('bal-refresh'); if(rb){ rb.disabled=true; rb.textContent='刷新中…'; }
    var done=0; function fin(){ if(++done>=2 && rb){ rb.disabled=false; rb.textContent='刷新'; } }
    // handle Stripe return query params, then strip them so a refresh doesn't re-show the banner
    if(/[?&]topup=success(?:&|$)/.test(location.search)){
      var h=$('bal-topup-success'); if(h) h.style.display='block';
      history.replaceState(null,'',location.pathname+location.hash);
      pollBalance(5); // async webhook may credit a few seconds after redirect
    } else if(/[?&]topup=cancel(?:&|$)/.test(location.search)){
      var oc=$('bal-topup-out'); if(oc){ oc.style.display='block'; oc.innerHTML='<span class="hint">已取消充值</span>'; }
      history.replaceState(null,'',location.pathname+location.hash);
    }
    api('/me/balance').then(function(r){
      // distinguish a failed read from a genuine zero balance — never show fake 0.00
      if(!(r.ok && r.body && r.body.balance_micro!=null)){ $('bal-usd').innerHTML='<span class="e">读取失败</span>'; fin(); return; }
      var bal=r.body.balance_micro;
      $('bal-usd').textContent = usd2(bal);
      $('bal-usd').style.color = bal<=0 ? 'var(--red)' : '';
      fin();
    }).catch(function(){ $('bal-usd').textContent='–'; fin(); });
    var tb=$('bal-txns-body');
    api('/me/transactions').then(function(r){
      var list=Array.isArray(r.body)?r.body:[];
      if(!list.length){ tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">暂无</td></tr>'; fin(); return; }
      tb.innerHTML=list.map(function(t){ return txnRow(t, false); }).join('');
      fin();
    }).catch(function(){ tb.innerHTML='<tr><td colspan="7" class="e">出错</td></tr>'; fin(); });
  }
  // short-poll balance after a Stripe success so async webhook credit reflects without a manual refresh
  function pollBalance(left){
    if(left<=0) return;
    setTimeout(function(){
      api('/me/balance').then(function(r){
        if(r.ok && r.body && r.body.balance_micro!=null){
          var bal=r.body.balance_micro;
          $('bal-usd').textContent = usd2(bal);
          $('bal-usd').style.color = bal<=0 ? 'var(--red)' : '';
        }
        pollBalance(left-1);
      }).catch(function(){ pollBalance(left-1); });
    }, 3000);
  }

  // ---------------- admin: per-key list ----------------
  // Scale-safe 检测全部: the backend probes the pool in rotating batches (~48/
  // call, Worker subrequest cap). The button marks the whole pool due (?all=1),
  // then drains batches while showing progress. It's non-blocking — closing the
  // page is fine, the external pinger/cron keeps draining in the background.
  var keylistSweeping = false;
  var keylistStopped = false;
  function renderSweepProgress(done, total){
    var out=$('keylist-checkall-out'); if(!out) return;
    var pct = total>0 ? Math.min(100, Math.round(done*100/total)) : 0;
    var W=24, fill=Math.round(pct*W/100);
    var bar='['+Array(fill+1).join('█')+Array(W-fill+1).join('·')+']';
    out.innerHTML='检测中 '+bar+' '+done+' / '+total+'(可关闭页面,后台继续)';
  }
  function checkAllKeys(){
    var btn=$('keylist-checkall'), out=$('keylist-checkall-out');
    if(keylistSweeping){ keylistSweeping=false; keylistStopped=true; if(btn) btn.textContent='检测全部'; return; }
    keylistSweeping=true; keylistStopped=false; if(btn) btn.textContent='停止检测';
    if(out) out.textContent='标记全部待检测…';
    var total=0, lastDue=-1, stall=0, batches=0;
    function drain(markAll){
      if(!keylistSweeping) return Promise.resolve();
      return api('/admin/sweep'+(markAll?'?all=1':''),{method:'POST'}).then(function(r){
        // A failed sweep must stop the loop loudly, not look like a finished
        // check: the old code treated a 500 body as an empty batch and kept
        // "draining" until the stall guard gave up on a fake success.
        if(!r.ok) throw new Error('sweep failed: '+r.status);
        var b=r.body||{}; total=b.total||total;
        var due=(b.due==null?0:b.due); renderSweepProgress(Math.max(0,total-due), total);
        batches++; if(batches%5===0) loadKeyList();           // periodic list refresh
        if(due===lastDue){ if(++stall>=2) return; } else { stall=0; lastDue=due; }
        if(due>0 && keylistSweeping){
          return new Promise(function(res){ setTimeout(res,300); }).then(function(){ return drain(false); });
        }
      });
    }
    drain(true).then(function(){
      keylistSweeping=false; if(btn) btn.textContent='检测全部';
      if(out) out.textContent= keylistStopped ? '已停止检测' : '已检测全部 '+(total||'')+' 个 key,见下方状态';
      loadKeyList();
    }).catch(function(){
      keylistSweeping=false; if(btn) btn.textContent='检测全部';
      if(out) out.textContent='出错(后台轮转仍会继续)'; loadKeyList();
    });
  }
  var keylistShowDisabled = false;
  function loadKeyList(){
    var tb=$('keylist-body');
    tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">加载中…</td></tr>';
    return api('/admin/keys/list').then(function(r){
      var all=(r.body && r.body.keys) || [];
      var sm=$('keylist-summary');
      if(sm){
        var cD=0,cC=0,cW=0,cA=0;
        all.forEach(function(k){
          if(k.status==='disabled') cD++;
          else if(k.status==='cooldown') cC++;
          else if(k.last_error) cW++;
          else cA++;
        });
        sm.innerHTML = all.length
          ? ('共 '+all.length+' · 可用 '+cA+' · 冷却 '+cC+' · 禁用 '+cD+(cW?' · 异常 '+cW:''))
          : '池子为空';
      }
      var disN = all.filter(function(k){return k.status==='disabled';}).length;
      var tg=$('keylist-toggle'); if(tg) tg.textContent = keylistShowDisabled ? '只看启用' : ('显示禁用('+disN+')');
      var keys = keylistShowDisabled ? all : all.filter(function(k){return k.status!=='disabled';});
      if(!all.length){ tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">还没有 key</td></tr>'; return; }
      if(!keys.length){ tb.innerHTML='<tr><td colspan="7" style="color:var(--faint)">全部已禁用 · 点「显示禁用」查看</td></tr>'; return; }
      tb.innerHTML = keys.map(function(k){
        // active + a lingering last_error = valid key that's currently failing
        // (e.g. throttled gemini) — show amber 'warn', not a misleading green.
        var sd = k.status==='disabled' ? 'd-disabled'
               : k.status==='cooldown' ? 'd-cooldown'
               : k.last_error ? 'd-warn'
               : 'd-active';
        var reason = (k.status==='disabled' && k.disabled_reason) ? k.disabled_reason : k.last_error;
        var err = reason ? esc(String(reason).slice(0,60)) : '';
        var sLabel = sd==='d-disabled'?'已禁用':sd==='d-cooldown'?'冷却中':sd==='d-warn'?'异常(仍在用)':'可用';
        var toggle = (k.status==='active')
          ? '<button class="btn ghost small kl-disable">禁用</button>'
          : '<button class="btn ghost small kl-enable">启用</button>';
        // gemini keys carry a Google project id (parsed on probe); show a short
        // 'proj …<last4>' badge so the operator can spot keys sharing a project.
        var proj = k.project_id
          ? ' <span class="badge" style="background:var(--creamy);border-color:#cfcbbd;color:var(--faint);font-size:9.5px;padding:0 6px" title="project '+esc(String(k.project_id))+'">proj …'+esc(String(k.project_id).slice(-4))+'</span>'
          : '';
        // per-key health surfacing: consecutive-fail streak, cooldown deadline, last-used.
        var cf = (k.consecutive_fails>0) ? ' <span style="color:var(--red)">(连败 '+k.consecutive_fails+'/3)</span>' : '';
        var cool = (k.status==='cooldown' && k.cooldown_until) ? ('冷却至 '+fmtDate(k.cooldown_until)) : '';
        var luTitle = '最近使用 '+(k.last_used_at ? fmtDate(k.last_used_at) : '从未使用');
        // Stored upstream balance (openrouter/deepseek expose one) — show on load
        // so operators don't have to click 测活 for each. 测活 refreshes it live.
        var balStr = (k.balance_remaining!=null)
          ? '余 '+(Math.round(k.balance_remaining*100)/100)+' '+(k.balance_unit||'') : '';
        // Custom keys are named by their service (slug): showing just the
        // provider ("custom") makes every custom key indistinguishable.
        var provName = (k.provider === 'custom' && k.service_slug) ? k.service_slug : k.provider;
        // Every key is editable: any key can rotate its api_key; custom keys
        // can also change their service name and base URL.
        var editBtn = '<button class="btn ghost small kl-edit">编辑</button> ';
        return '<tr data-id="'+k.id+'" data-provider="'+esc(k.provider||'')+'" data-slug="'+esc(k.service_slug||'')+'" data-base="'+esc(k.base_url||'')+'">'
          +'<td><span class="dot '+sd+'" title="'+sLabel+'"></span>'+esc(provName)+proj+'</td>'
          +'<td style="font-family:ui-monospace,monospace;font-size:12.5px;white-space:nowrap">'+esc(k.masked)+' <button class="btn ghost small kl-copy" title="复制完整 key">复制</button></td>'
          +'<td class="n">'+k.total_requests+' / '+k.total_fails+cf+'</td>'
          +'<td class="kl-err" style="max-width:180px;color:var(--faint);font-size:12px;overflow:hidden;text-overflow:ellipsis"'+((cool||reason)?' title="'+esc(cool||String(reason))+'"':'')+'>'+(cool?'<span style="color:var(--amber)">'+esc(cool)+'</span>':err)+'</td>'
          +'<td class="kl-result" style="font-size:12.5px;white-space:nowrap">'+(balStr?'<span style="color:var(--faint)" title="上次探测余额">'+esc(balStr)+'</span>':'')+'</td>'
          +'<td style="color:var(--faint);font-size:12px;white-space:nowrap" title="'+esc((k.created_at?'添加于 '+new Date(k.created_at).toLocaleString()+' · ':'')+luTitle)+'">'+(k.created_at?fmtDate(k.created_at):'–')+'</td>'
          +'<td style="white-space:nowrap"><button class="btn ghost small kl-check">测活</button> <button class="btn ghost small kl-addmodel">新增模型</button> '+editBtn+toggle+' <button class="btn ghost small kl-del">删</button></td>'
          +'</tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('tr[data-id]'), function(tr){
        var id=tr.getAttribute('data-id');
        var res=tr.querySelector('.kl-result');
        var chk=tr.querySelector('.kl-check');
        if(chk) chk.onclick=function(){
          chk.disabled=true; res.textContent='测…';
          api('/admin/keys/'+id+'/check',{method:'POST'}).then(function(r){
            chk.disabled=false; var b=r.body||{};
            var dot=tr.querySelector('.dot');
            var ec=tr.querySelector('.kl-err');
            if(b.alive){
              var bal = (b.balance && b.balance.remaining!=null)
                ? ' · 余 '+(Math.round(b.balance.remaining*100)/100)+' '+b.balance.unit : '';
              res.innerHTML='<span style="color:var(--green)">可用'+(b.rateLimited?'(限流)':'')+'</span>'+bal;
              // a passing check reactivates the key server-side (unless rate-limited).
              // reflect that on THIS row in place — never reload the whole table, which
              // would wipe other rows' in-progress 测活 results.
              if(dot){
                if(b.rateLimited){ dot.className='dot d-warn'; dot.title='异常(仍在用)'; }
                else { dot.className='dot d-active'; dot.title='可用'; if(ec){ ec.textContent=''; ec.removeAttribute('title'); } }
              }
            } else { res.innerHTML='<span style="color:var(--red)">不可用 '+(b.status||'')+'</span>'; }
          }).catch(function(){ chk.disabled=false; res.innerHTML='<span style="color:var(--red)">出错</span>'; });
        };
        // 「新增模型」:用该 key 已存的凭证实时拉取上游模型列表,勾选后记为
        // 可用并进入 /v1/models。面板展开在该行下方,新模型默认勾选。
        var am=tr.querySelector('.kl-addmodel'); if(am) am.onclick=function(){
          var next=tr.nextSibling;
          if(next && next.className && next.className.indexOf('kl-addmodel-row')>=0){ next.parentNode.removeChild(next); return; }
          var panel=document.createElement('tr');
          panel.className='kl-addmodel-row';
          panel.innerHTML='<td colspan="7"><div style="padding:8px 0">'
            +'<div class="kl-am-top" style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><input class="kl-am-q" placeholder="筛选模型…" style="flex:1"><button class="btn primary small kl-am-add" disabled>添加选中</button><button class="btn ghost small kl-am-cancel">取消</button></div>'
            +'<div class="kl-am-status hint">正在用该 key 向上游拉取模型列表…</div>'
            +'<div class="kl-am-list" style="max-height:220px;overflow:auto;margin-top:6px"></div>'
            +'<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px"><div class="hint" style="margin-bottom:4px">自定义模型：不在上游列表里的模型 ID 也可以直接加（每行一个；下次探活会自动验证，调不通的会被屏蔽）</div>'
            +'<textarea class="kl-am-custom" rows="2" placeholder="例如 openai/gpt-oss-120b:free" style="width:100%;box-sizing:border-box"></textarea>'
            +'<div style="margin-top:6px"><button class="btn small kl-am-addcustom">添加自定义</button></div></div>'
            +'</div></td>';
          tr.parentNode.insertBefore(panel, tr.nextSibling);
          var listEl=panel.querySelector('.kl-am-list');
          var statusEl=panel.querySelector('.kl-am-status');
          var addBtn=panel.querySelector('.kl-am-add');
          var qEl=panel.querySelector('.kl-am-q');
          var fetched=[];
          function updateAmAddBtn(){
            var n=listEl.querySelectorAll('input[type=checkbox]:checked').length;
            addBtn.disabled=!n;
            addBtn.textContent=n?('添加选中 ('+n+')'):'添加选中';
          }
          function amCloseAfter(){
            // 反馈在面板顶部、按钮在底部，矮视口下看不到：先滚到反馈处，读完再自动收起面板。
            statusEl.scrollIntoView({ block:'nearest' });
            setTimeout(function(){ if (panel.isConnected && panel.parentNode) panel.parentNode.removeChild(panel); }, 1500);
          }
          function renderAmList(){
            var needle=(qEl.value||'').trim().toLowerCase();
            var shown=needle?fetched.filter(function(m){return m.id.toLowerCase().indexOf(needle)>=0;}):fetched;
            listEl.innerHTML=shown.length?shown.map(function(m){
              return '<label style="display:block;margin:4px 0"><input type="checkbox" value="'+esc(m.id)+'"'+(m.isNew?' checked':'')+'> '+esc(m.id)+(m.isNew?' <span class="badge">新</span>':'')+'</label>';
            }).join(''):'<div class="hint">没有匹配的模型</div>';
            updateAmAddBtn();
          }
          listEl.addEventListener('change', updateAmAddBtn);
          qEl.oninput=renderAmList;
          panel.querySelector('.kl-am-cancel').onclick=function(){ panel.parentNode.removeChild(panel); };
          api('/admin/keys/'+id+'/live-models',{method:'POST'}).then(function(r){
            if(!r.ok || !r.body || !Array.isArray(r.body.models)){
              statusEl.innerHTML='<span class="e">拉取失败 '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>';
              return;
            }
            var known={}; (r.body.known||[]).forEach(function(m){ known[m]=1; });
            fetched=r.body.models.map(function(m){ return { id:m, isNew:!known[m] }; });
            var nNew=fetched.filter(function(m){ return m.isNew; }).length;
            statusEl.textContent='共 '+fetched.length+' 个模型 · 新模型 '+nNew+' 个已默认勾选（已有模型不勾选）';
            renderAmList();
          }).catch(function(){ statusEl.innerHTML='<span class="e">网络错误</span>'; });
          addBtn.onclick=function(){
            var sel=Array.prototype.map.call(listEl.querySelectorAll('input[type=checkbox]:checked'),function(cb){ return cb.value; });
            if(!sel.length) return;
            addBtn.disabled=true; statusEl.textContent='添加中…';
            api('/admin/keys/'+id+'/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models:sel})}).then(function(r){
              if(!r.ok){
                statusEl.innerHTML='<span class="e">添加失败 '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>';
                statusEl.scrollIntoView({ block:'nearest' });
                addBtn.disabled=false; return;
              }
              statusEl.innerHTML='<span class="k">已添加 '+(r.body.added||0)+' 个新模型（共提交 '+(r.body.total||0)+' 个）</span> · 模型列表已刷新';
              amCloseAfter();
              loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); });
              addBtn.disabled=false;
            }).catch(function(){ statusEl.innerHTML='<span class="e">网络错误</span>'; statusEl.scrollIntoView({ block:'nearest' }); addBtn.disabled=false; });
          };
          // 自定义模型：直接输入模型 ID（每行一个），不依赖上游列表是否拉取成功。
          var customBtn=panel.querySelector('.kl-am-addcustom');
          if(customBtn) customBtn.onclick=function(){
            var ta=panel.querySelector('.kl-am-custom');
            var typed=(ta.value||'').split(/[\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
            var bad=typed.filter(function(s){ return /\s/.test(s); });
            var list=typed.filter(function(s){ return !/\s/.test(s); });
            list=list.filter(function(v,i){ return list.indexOf(v)===i; });
            if(!list.length){ statusEl.innerHTML='<span class="e">先输入模型 ID（每行一个，ID 里不能有空格）</span>'; return; }
            customBtn.disabled=true; statusEl.textContent='添加中…';
            api('/admin/keys/'+id+'/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models:list})}).then(function(r){
              if(!r.ok){
                statusEl.innerHTML='<span class="e">添加失败 '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>';
                statusEl.scrollIntoView({ block:'nearest' });
                customBtn.disabled=false; return;
              }
              var note=bad.length?(' · 已跳过含空格的输入：'+esc(bad.join('、'))):'';
              statusEl.innerHTML='<span class="k">已添加 '+(r.body.added||0)+' 个新模型（共提交 '+(r.body.total||0)+' 个）</span> · 模型列表已刷新'+note;
              amCloseAfter();
              ta.value='';
              loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); });
              customBtn.disabled=false;
            }).catch(function(){ statusEl.innerHTML='<span class="e">网络错误</span>'; statusEl.scrollIntoView({ block:'nearest' }); customBtn.disabled=false; });
          };
        };
        // 「编辑」:改 key 值（所有 key 都能改）以及自定义服务的服务名和 API
        // 地址。改服务名会连同它的模型一起改名；只改地址不影响模型。换 key
        // 值会清掉这把 key 的失败状态（失败次数、冷却、上次错误），手动禁用
        // 的保持禁用。内置供应商没有可改的名字和地址。
        var ed=tr.querySelector('.kl-edit'); if(ed) ed.onclick=function(){
          var next=tr.nextSibling;
          if(next && next.className && next.className.indexOf('kl-edit-row')>=0){ next.parentNode.removeChild(next); return; }
          var isCustom = tr.getAttribute('data-provider') === 'custom';
          var panel=document.createElement('tr');
          panel.className='kl-edit-row';
          var fields='';
          if(isCustom){
            fields+='<label style="display:flex;gap:6px;align-items:center">服务名 <input class="kl-ed-slug" value="'+esc(tr.getAttribute('data-slug')||'')+'" style="width:140px"></label>'
              +'<label style="display:flex;gap:6px;align-items:center;flex:1">API 地址 <input class="kl-ed-base" value="'+esc(tr.getAttribute('data-base')||'')+'" style="flex:1;min-width:220px"></label>';
          }
          fields+='<label style="display:flex;gap:6px;align-items:center;flex:1">API Key <input type="password" class="kl-ed-key" placeholder="留空则不改" style="flex:1;min-width:220px"></label>';
          panel.innerHTML='<td colspan="7"><div style="padding:8px 0">'
            +'<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">'
            +fields
            +'<button class="btn primary small kl-ed-save">保存</button><button class="btn ghost small kl-ed-cancel">取消</button></div>'
            +'<div class="kl-ed-status hint">'+(isCustom?'改服务名会连同它的模型一起改名；只改地址不影响模型。服务名须为小写字母/数字/连字符（1-32 字符）。':'内置供应商只能改 key 值；供应商和地址是固定的。')+'API Key 留空则不改；填了就替换，并清掉这把 key 的失败状态。</div>'
            +'</div></td>';
          tr.parentNode.insertBefore(panel, tr.nextSibling);
          var statusEl=panel.querySelector('.kl-ed-status');
          var saveBtn=panel.querySelector('.kl-ed-save');
          panel.querySelector('.kl-ed-cancel').onclick=function(){ panel.parentNode.removeChild(panel); };
          saveBtn.onclick=function(){
            var body={};
            var keyed=false;
            if(isCustom){
              var slug=(panel.querySelector('.kl-ed-slug').value||'').trim().toLowerCase();
              var base=(panel.querySelector('.kl-ed-base').value||'').trim();
              if(!slug){ statusEl.innerHTML='<span class="e">服务名不能为空</span>'; return; }
              if(!/^https?:\/\//i.test(base)){ statusEl.innerHTML='<span class="e">API 地址须为 http(s) 地址</span>'; return; }
              body.service_slug=slug; body.base_url=base; keyed=true;
            }
            var apiKey=(panel.querySelector('.kl-ed-key').value||'').trim();
            if(apiKey){ body.api_key=apiKey; keyed=true; }
            if(!keyed){ statusEl.innerHTML='<span class="e">没有要改的内容</span>'; return; }
            saveBtn.disabled=true; statusEl.textContent='保存中…';
            api('/admin/keys/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){
              if(!r.ok){
                statusEl.innerHTML='<span class="e">保存失败 '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>';
                statusEl.scrollIntoView({ block:'nearest' });
                saveBtn.disabled=false; return;
              }
              var renamed=(r.body.renamed_models||0);
              statusEl.innerHTML='<span class="k">已保存</span>'+(renamed?(' · '+renamed+' 个模型已随服务名改名'):'')+(apiKey?' · API Key 已更新':'')+' · 列表已刷新';
              statusEl.scrollIntoView({ block:'nearest' });
              setTimeout(function(){
                if(panel.isConnected && panel.parentNode) panel.parentNode.removeChild(panel);
                loadKeyList();
                loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); });
              }, 1500);
            }).catch(function(){ statusEl.innerHTML='<span class="e">网络错误</span>'; statusEl.scrollIntoView({ block:'nearest' }); saveBtn.disabled=false; });
          };
        };
        var cp=tr.querySelector('.kl-copy'); if(cp) cp.onclick=function(){ cp.disabled=true; var o=cp.textContent; api('/admin/keys/'+id+'/reveal').then(function(r){ cp.disabled=false; if(r.ok && r.body && r.body.api_key){ copy(r.body.api_key, cp); } else { cp.textContent='失败'; setTimeout(function(){cp.textContent=o;},900); } }).catch(function(){ cp.disabled=false; cp.textContent='失败'; setTimeout(function(){cp.textContent=o;},900); }); };
        var en=tr.querySelector('.kl-enable'); if(en) en.onclick=function(){ api('/admin/keys/'+id+'/enable',{method:'POST'}).then(loadKeyList); };
        var dis=tr.querySelector('.kl-disable'); if(dis) dis.onclick=function(){ api('/admin/keys/'+id+'/disable',{method:'POST'}).then(loadKeyList); };
        // Delete opens an inline confirmation panel with a dedicated
        // confirm button. A native confirm() dialog is swallowed by
        // automated browsers, and a two-step button (arm on first click,
        // delete on second) proved unreliable too: the second click did not
        // reach the armed state, and no failure was ever reported. A panel
        // keeps the confirm action on its own stable button, like the
        // add-model and edit panels (whose buttons verify fine).
        var del=tr.querySelector('.kl-del'); if(del) del.onclick=function(){
          var next=tr.nextSibling;
          if(next && next.className && next.className.indexOf('kl-del-row')>=0){ next.parentNode.removeChild(next); return; }
          var panel=document.createElement('tr');
          panel.className='kl-del-row';
          panel.innerHTML='<td colspan="7"><div style="padding:8px 0">'
            +'<div style="margin-bottom:6px">确认删除这个 key？删除后不可恢复。</div>'
            +'<div style="display:flex;gap:8px;align-items:center"><button class="btn primary small kl-del-confirm">确认删除</button><button class="btn ghost small kl-del-cancel">取消</button><span class="kl-del-status hint"></span></div>'
            +'</div></td>';
          tr.parentNode.insertBefore(panel, tr.nextSibling);
          var statusEl=panel.querySelector('.kl-del-status');
          var confirmBtn=panel.querySelector('.kl-del-confirm');
          panel.querySelector('.kl-del-cancel').onclick=function(){ panel.parentNode.removeChild(panel); };
          confirmBtn.onclick=function(){
            confirmBtn.disabled=true; statusEl.textContent='删除中…';
            api('/admin/keys/'+id,{method:'DELETE'}).then(function(r){
              if(!r.ok){
                statusEl.innerHTML='<span class="e">删除失败 '+r.status+'</span>';
                confirmBtn.disabled=false; return;
              }
              loadKeyList();
            }).catch(function(){
              statusEl.innerHTML='<span class="e">删除出错（网络）</span>';
              confirmBtn.disabled=false;
            });
          };
        };
      });
    }).catch(function(){
      tb.innerHTML='<tr><td colspan="7" style="color:var(--red)">加载失败 · <button class="btn ghost small" id="keylist-retry">重试</button></td></tr>';
      var rb=$('keylist-retry'); if(rb) rb.onclick=loadKeyList;
      var sm=$('keylist-summary'); if(sm) sm.innerHTML='';
    });
  }

  // ---------------- consumer: dashboard ----------------
  function loadDashboard(){
    $('dash-greet').textContent = '// 欢迎回来, ' + (me.email||'');
    var ep = 'POST ' + base + '/v1/chat/completions';
    var es=$('dash-endpoint'); es.textContent = ep; es.setAttribute('data-copy', ep); bindCopy(es.parentNode);
    var cc=$('dash-curl-copy'); if(cc) cc.onclick = function(){ copy($('dash-curl').textContent, cc); };
    var tu=$('dash-topup'); if(tu) tu.onclick = function(){ selectSection('balance'); };
    loadDashTokens();
    loadDashStats();
  }
  function loadDashTokens(){
    var area=$('dash-token-area');
    area.innerHTML = '<div class="hint" style="color:var(--faint)">加载令牌中…</div>';
    api('/me/tokens').then(function(r){
      if(!r.ok){
        area.innerHTML = '<span class="e">令牌加载失败</span> · <button class="btn ghost small" id="dash-tok-retry">重试</button>';
        var rb=$('dash-tok-retry'); if(rb) rb.onclick=loadDashTokens;
        $('dash-curl').innerHTML = curlSnippet(null); return;
      }
      var list = Array.isArray(r.body)? r.body : [];
      var enabled = list.filter(function(t){ return t.enabled; });
      var tok = enabled.length ? enabled[0].token : null;
      if(tok){
        area.innerHTML = '<label>你的令牌</label>'
          + '<div class="endpoint"><span class="mono-token copyable" data-copy="'+esc(tok)+'">'+esc(tok)+'</span></div>'
          + '<div class="hint">点击即可复制。更多令牌见「我的令牌」。</div>';
        bindCopy(area);
      } else if(me.status!=='approved'){
        area.innerHTML = '<div class="hint">账号待开通，请联系管理员</div>';
      } else {
        area.innerHTML = '<button class="btn primary" id="dash-first">生成我的第一个令牌</button>'
          + '<div class="hint">还没有令牌。生成后即可调用接口。</div>';
        $('dash-first').onclick = function(){ selectSection('tokens'); };
      }
      $('dash-curl').innerHTML = curlSnippet(tok);
    }).catch(function(){
      area.innerHTML = '<span class="e">网络错误</span> · <button class="btn ghost small" id="dash-tok-retry">重试</button>';
      var rb=$('dash-tok-retry'); if(rb) rb.onclick=loadDashTokens;
      $('dash-curl').innerHTML = curlSnippet(null);
    });
  }
  function loadDashStats(){
    var bn=$('dash-balance'), bh=$('dash-bal-hint');
    bn.textContent='…'; if(bh) bh.style.display='none';
    api('/me/balance').then(function(r){
      // distinguish a failed read from a genuine zero balance — never show fake 0.0000
      if(!(r.ok && r.body && r.body.balance_micro!=null)){ bn.innerHTML='<span class="e">读取失败</span>'; return; }
      var bal=r.body.balance_micro;
      bn.textContent = usd(bal);
      if(bh) bh.style.display = bal<=0 ? 'block' : 'none';
    }).catch(function(){ bn.textContent='–'; });
    var rq=$('dash-req'), tk=$('dash-tok');
    rq.textContent='…'; tk.textContent='…';
    api('/me/usage').then(function(r){
      if(!(r.ok && r.body)){ rq.textContent='–'; tk.textContent='–'; return; }
      rq.textContent = fmtNum(r.body.total||0);
      tk.textContent = fmtNum(r.body.tokens||0);
    }).catch(function(){ rq.textContent='–'; tk.textContent='–'; });
  }
  function curlSnippet(tok){
    var key = tok || '$KEY';
    var model = (modelsCache && modelsCache[0] && modelsCache[0].id) || 'gemini-2.0-flash';
    return 'curl ' + base + '/v1/chat/completions \\\n'
      + '  -H "Authorization: Bearer ' + esc(key) + '" \\\n'
      + '  -H "Content-Type: application/json" \\\n'
      + '  -d \'{"model":"' + esc(model) + '","messages":[{"role":"user","content":"hello"}]}\'';
  }

  function bindCopy(scope){
    Array.prototype.forEach.call((scope||document).querySelectorAll('.copyable'), function(el){
      if(el.__bound) return; el.__bound=true;
      el.onclick = function(){ copy(el.getAttribute('data-copy'), el); };
    });
  }

  // ---------------- consumer: my tokens ----------------
  function loadMyTokens(){
    var tb=$('my-token-list');
    if(tb) tb.innerHTML='<tr><td colspan="9" style="color:var(--faint)">加载中…</td></tr>';
    return api('/me/tokens').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="9" style="color:var(--red)">加载失败 · '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+' <button class="btn ghost small" id="my-tokens-retry">重试</button></td></tr>'; var rb=$('my-tokens-retry'); if(rb) rb.onclick=loadMyTokens; return; }
      var list = Array.isArray(r.body)? r.body : [];
      if(!list.length){ tb.innerHTML='<tr><td colspan="9" style="color:var(--faint)">还没有令牌</td></tr>'; return; }
      tb.innerHTML = list.map(function(t){
        var expired = t.expires_at!=null && Date.now()>t.expires_at;
        return '<tr><td>'+t.id+'</td>'
          + '<td style="font-weight:700">'+esc(t.name||'–')+'</td>'
          + '<td><span class="mono-token copyable" data-copy="'+esc(t.token)+'">'+esc(t.token)+'</span></td>'
          + '<td>'+(expired?'<span class="dot d-disabled"></span><span style="color:var(--red)">已过期</span>':'<span class="dot '+(t.enabled?'d-active':'d-disabled')+'"></span>'+(t.enabled?'启用':'停用'))+'</td>'
          + '<td class="n">'+t.used_requests+'/'+(t.quota_requests==null?'∞':t.quota_requests)+'</td>'
          + '<td class="n">'+(t.rpm_limit==null?'∞':t.rpm_limit+'/min')+'</td>'
          + '<td style="color:var(--faint)">'+(t.expires_at==null?'永久':(expired?'<span style="color:var(--red)">已过期</span>':fmtDate(t.expires_at)))+'</td>'
          + '<td style="color:var(--faint)">'+fmtDate(t.created_at)+'</td>'
          + '<td><button class="btn ghost small" data-del="'+t.id+'">删除</button></td></tr>';
      }).join('');
      bindCopy(tb);
      Array.prototype.forEach.call(tb.querySelectorAll('[data-del]'), function(b){
        b.onclick = function(){
          if(!confirm('删除该令牌？此操作不可撤销。')) return;
          b.disabled=true;
          api('/me/tokens/'+b.getAttribute('data-del'),{method:'DELETE'}).then(function(r){
            if(!r.ok){
              b.disabled=false;
              var msg=(r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status);
              alert('删除失败: '+msg);
              return;
            }
            loadMyTokens();
          }).catch(function(){ b.disabled=false; alert('删除失败: 网络错误'); });
        };
      });
    }).catch(function(){ if(tb) tb.innerHTML='<tr><td colspan="9" style="color:var(--red)">网络错误</td></tr>'; });
  }
  function mintMy(){
    var name=$('my-tname').value.trim();
    var btn=$('my-mint'); btn.disabled=true; btn.textContent='生成中…';
    api('/me/tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name})})
    .then(function(r){ btn.disabled=false; btn.textContent='生成令牌'; var o=$('my-mint-out'); o.style.display='block';
      if(!r.ok){
        var msg=(r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status);
        o.innerHTML='<span class="e">'+esc(msg)+'</span>'; return;
      }
      o.innerHTML='新令牌(立即复制): <span class="k mono-token copyable" data-copy="'+esc(r.body.token)+'">'+esc(r.body.token)+'</span> <button class="btn ghost small" id="my-mint-close">我已复制 · 关闭</button>';
      bindCopy(o); var cb=$('my-mint-close'); if(cb) cb.onclick=function(){ o.style.display='none'; o.innerHTML=''; }; $('my-tname').value=''; loadMyTokens();
    }).catch(function(){ btn.disabled=false; btn.textContent='生成令牌'; var o=$('my-mint-out'); o.style.display='block'; o.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- docs (shared, static from models) ----------------
  function fillDocs(){
    var model = (modelsCache && modelsCache[0] && modelsCache[0].id) || 'gemini-2.0-flash';
    function setEp(id, val){ var el=$(id); if(!el) return; el.textContent=val; el.setAttribute('data-copy', val); }
    setEp('docs-endpoint', 'POST ' + base + '/v1/chat/completions');
    setEp('docs-baseurl', base + '/v1');
    setEp('docs-models-ep', base + '/v1/models');
    setEp('docs-anthropic-ep', base + '/v1/messages');

    var curlRaw = 'curl ' + base + '/v1/chat/completions \\\n'
      + '  -H "Authorization: Bearer <你的令牌>" \\\n'
      + '  -H "Content-Type: application/json" \\\n'
      + '  -d \'{"model":"' + model + '","messages":[{"role":"user","content":"hello"}]}\'';
    $('docs-curl').innerHTML = esc(curlRaw);

    var reqRaw = '{\n'
      + '  "model": "' + model + '",\n'
      + '  "messages": [{"role":"user","content":"hello"}],\n'
      + '  "stream": false,\n'
      + '  "fallback": true\n'
      + '}';
    if($('docs-reqbody')) $('docs-reqbody').innerHTML = esc(reqRaw);

    var sdkRaw = 'from openai import OpenAI\n'
      + 'client = OpenAI(\n'
      + '    base_url="' + base + '/v1",\n'
      + '    api_key="<你的令牌>",\n'
      + ')\n'
      + 'resp = client.chat.completions.create(\n'
      + '    model="' + model + '",\n'
      + '    messages=[{"role":"user","content":"hello"}],\n'
      + ')\n'
      + 'print(resp.choices[0].message.content)';
    $('docs-sdk').innerHTML = esc(sdkRaw);

    var anthRaw = 'curl ' + base + '/v1/messages \\\n'
      + '  -H "x-api-key: <你的令牌>" \\\n'
      + '  -H "anthropic-version: 2023-06-01" \\\n'
      + '  -H "Content-Type: application/json" \\\n'
      + '  -d \'{"model":"' + model + '","max_tokens":1024,"messages":[{"role":"user","content":"hello"}]}\'';
    if($('docs-anthropic')) $('docs-anthropic').innerHTML = esc(anthRaw);

    function bindBtn(id, raw){ var b=$(id); if(b) b.onclick=function(){ copy(raw, this); }; }
    bindBtn('docs-curl-copy', curlRaw);
    bindBtn('docs-reqbody-copy', reqRaw);
    bindBtn('docs-sdk-copy', sdkRaw);
    bindBtn('docs-anthropic-copy', anthRaw);

    bindCopy($('sec-docs'));
  }

  // ---------------- admin: stats (overview + keys) ----------------
  function renderStats(s, tbodyId){
    var t=(s&&s.totals)||{active:0,cooldown:0,disabled:0};
    if($('t-active')){ $('t-active').textContent=t.active; $('t-cooldown').textContent=t.cooldown; $('t-disabled').textContent=t.disabled; }
    var total=(t.active||0)+(t.cooldown||0)+(t.disabled||0);
    // overview-only: one-line health verdict + 更新于 stamp in the 池子状态 card header
    if(tbodyId==='ov-byprovider'){
      var vd=$('ov-verdict');
      if(vd){
        if(total===0) vd.innerHTML='<span class="dot d-disabled"></span>池子为空';
        else if((t.cooldown||0)+(t.disabled||0)===0) vd.innerHTML='<span class="dot d-active"></span>全部可用';
        else vd.innerHTML='<span class="dot d-cooldown"></span>有 '+(t.cooldown||0)+' 个冷却 · '+(t.disabled||0)+' 个禁用';
      }
      var stp=$('ov-stamp'); if(stp) stp.textContent='更新于 '+fmtDate(Date.now());
    }
    var html='';
    if(total===0){
      // pool empty: don't render phantom all-zero gemini/mistral/openrouter rows
      html='<tr><td colspan="4" class="kp-stats-empty" style="color:var(--faint);cursor:pointer">还没有 key · 去「Key 池」导入</td></tr>';
    } else {
      // Only providers that actually have keys — the old code seeded
      // gemini/mistral/openrouter unconditionally, so they showed 0/0/0
      // rows even when never added. Prefer that order when present.
      var prov={};
      ((s&&s.byProviderStatus)||[]).forEach(function(r){
        // Custom services are separate providers in practice: split them by
        // slug, or every service collapses into one unreadable "custom" row.
        var key = (r.provider === 'custom' && r.service_slug) ? r.service_slug : r.provider;
        if(!prov[key])prov[key]={active:0,cooldown:0,disabled:0};
        prov[key][r.status]=r.n;
      });
      var order=['gemini','mistral','openrouter'];
      Object.keys(prov).sort(function(a,b){ var ia=order.indexOf(a), ib=order.indexOf(b); if(ia<0)ia=order.length; if(ib<0)ib=order.length; return (ia-ib) || (a<b?-1:a>b?1:0); }).forEach(function(p){ var x=prov[p];
        html += '<tr><td style="font-weight:700">'+p+'</td>'
          +'<td class="n"><span class="dot d-active '+(x.active>0?'':'d-zero')+'"></span>'+x.active+'</td>'
          +'<td class="n"><span class="dot d-cooldown '+(x.cooldown>0?'':'d-zero')+'"></span>'+x.cooldown+'</td>'
          +'<td class="n"><span class="dot d-disabled '+(x.disabled>0?'':'d-zero')+'"></span>'+x.disabled+'</td></tr>';
      });
    }
    if($(tbodyId)){
      $(tbodyId).innerHTML = html;
      var ec=$(tbodyId).querySelector('.kp-stats-empty');
      if(ec) ec.onclick=function(){ selectSection('keys'); };
    }
  }
  function loadStats(prefix){
    var tbodyId = prefix==='ov' ? 'ov-byprovider' : 'keys-byprovider';
    if($(tbodyId)) $(tbodyId).innerHTML='<tr><td colspan="4" style="color:var(--faint)">加载中…</td></tr>';
    function errTiles(){ ['t-active','t-cooldown','t-disabled'].forEach(function(i){ if($(i)) $(i).textContent='–'; }); if(prefix==='ov'){ var vd=$('ov-verdict'); if(vd) vd.innerHTML=''; var stp=$('ov-stamp'); if(stp) stp.textContent=''; } }
    return api('/admin/keys').then(function(r){
      if(!r.ok){ if($(tbodyId)) $(tbodyId).innerHTML='<tr><td colspan="4" class="e">错误 '+r.status+'</td></tr>'; errTiles(); return; }
      renderStats(r.body, tbodyId);
    }).catch(function(){ if($(tbodyId)) $(tbodyId).innerHTML='<tr><td colspan="4" class="e">网络错误</td></tr>'; errTiles(); });
  }
  function probe(){
    var btn=$('ov-probe'); btn.disabled=true; var o=$('ov-probe-out'); o.style.display='block'; o.textContent='巡检中…';
    api('/admin/probe',{method:'POST'}).then(function(r){ btn.disabled=false;
      if(!r.ok){ o.innerHTML='<span class="e">错误 '+r.status+'</span>'; return; }
      var b=r.body||{};
      // format the typed fields into Chinese instead of dumping raw English JSON
      if(b.revived!=null || b.probed!=null || b.reactivated!=null)
        o.innerHTML='<span class="k">巡检完成</span> 唤醒冷却 '+(b.revived||0)+' · 探测禁用 '+(b.probed||0)+' · 复活 '+(b.reactivated||0);
      else o.innerHTML='<span class="k">巡检完成</span> '+esc(JSON.stringify(b));
      loadStats('ov');
    }).catch(function(){ btn.disabled=false; o.innerHTML='<span class="e">网络错误</span>'; });
  }
  function importKeys(){
    var keys=$('keys').value; if(!keys.trim()) return;
    var btn=$('importBtn'); btn.disabled=true; var o=$('importOut'); o.style.display='block'; o.textContent='导入中…(坏 key 会即时试调)';
    api('/admin/keys/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keys:keys})})
    .then(function(r){ btn.disabled=false;
      if(!r.ok){ o.innerHTML='<span class="e">'+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>'; return; }
      var b=r.body||{}, by=b.byProvider?Object.keys(b.byProvider).map(function(k){return k+'='+b.byProvider[k];}).join('  '):'';
      var skipN=(b.skipped&&b.skipped.length)||0;
      var html='<span class="k">新增 '+b.added+'</span>  重复 '+b.duplicate+'  跳过 '+skipN+'\n'+esc(by);
      if(skipN && Array.isArray(b.skipped)) html+='\n<span class="e">以下行已跳过(检查 provider 前缀):</span>\n'+b.skipped.map(function(s){return esc(String(s).slice(0,40));}).join('\n');
      o.innerHTML=html;
      $('keys').value=''; loadStats('keys'); loadStats('ov');
    }).catch(function(){ btn.disabled=false; o.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- admin: model availability ----------------
  function loadModelStatus(){
    var el=$('modelstatus-body'); if(!el) return;
    return api('/admin/models-status').then(function(r){
      if(!r.ok){ el.innerHTML='<span class="e">加载失败 · 错误 '+r.status+'</span>'; return; }
      var list=Array.isArray(r.body)?r.body:[];
      if(!list.length){ el.innerHTML='<span style="color:var(--faint)">尚未探测 · 点「探测模型」逐个试调</span>'; return; }
      var bad=list.filter(function(m){ return !m.available; });
      if(!bad.length){ el.innerHTML='<span style="color:var(--green)">全部模型可用</span> · 已探测 '+list.length+' 个'; return; }
      el.innerHTML = '<div style="margin-bottom:6px;color:var(--muted)">不可用 '+bad.length+' / 已探测 '+list.length+'</div>'
        + bad.map(function(m){
          return '<div style="margin:3px 0"><span class="dot d-disabled"></span><b class="mono-token">'+esc(m.model)+'</b>'
            +' <span style="color:var(--faint);font-size:12px">'+esc(m.provider||'')+'</span>'
            +(m.reason?' · <span style="color:var(--red);font-size:12px">'+esc(String(m.reason).slice(0,200))+'</span>':'')+'</div>';
        }).join('');
    }).catch(function(){ el.innerHTML='<span class="e">出错</span>'; });
  }
  function probeModels(){
    var btn=$('modelstatus-probe'); var el=$('modelstatus-body');
    if(btn) btn.disabled=true; if(el) el.innerHTML='探测中…(逐个模型试调一次,稍候十几秒)';
    api('/admin/probe-models',{method:'POST'}).then(function(r){ if(btn) btn.disabled=false;
      if(!r.ok){ if(el) el.innerHTML='<span class="e">探测出错 '+r.status+'</span>'; return; }
      var b=r.body||{};
      var p=loadModelStatus();
      if(el && b.checked!=null && p && p.then) p.then(function(){ el.innerHTML='<div style="margin-bottom:6px;color:var(--muted)">本轮探测 '+(b.checked||0)+' · 屏蔽 '+(b.blocked||0)+'</div>'+el.innerHTML; });
    }).catch(function(){ if(btn) btn.disabled=false; if(el) el.innerHTML='<span class="e">探测出错</span>'; });
  }

  // ---------------- Key 池: 添加自定义模型 ----------------
  // Same endpoint as the per-key panel (POST /admin/keys/:id/models), but
  // reachable from the pool page, where model availability lives. The key
  // select lists usable keys (active + cooldown, not disabled).
  function loadPoolCustomKeys(){
    var sel=$('pool-custom-key'); if(!sel) return;
    return api('/admin/keys/list').then(function(r){
      var list=(r.ok && r.body && Array.isArray(r.body.keys)) ? r.body.keys.filter(function(k){ return k.status!=='disabled'; }) : [];
      var b=$('pool-custom-add');
      if(!list.length){ sel.innerHTML='<option value="">还没有可用的 key · 先去上方导入</option>'; if(b) b.disabled=true; return; }
      sel.innerHTML=list.map(function(k){ var p=(k.provider==='custom'&&k.service_slug)?k.service_slug:k.provider; return '<option value="'+k.id+'">'+esc(p)+' #'+k.id+' · '+esc(k.masked||'')+'</option>'; }).join('');
      if(b) b.disabled=false;
    }).catch(function(){ sel.innerHTML='<option value="">加载 key 失败</option>'; });
  }
  function poolCustomAdd(){
    var sel=$('pool-custom-key'), ta=$('pool-custom-input'), out=$('pool-custom-out'), btn=$('pool-custom-add');
    var id=sel?sel.value:''; if(!id){ if(out) out.innerHTML='<span class="e">先选一个 key</span>'; return; }
    var typed=(ta.value||'').split(/[\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
    var bad=typed.filter(function(s){ return /\s/.test(s); });
    var list=typed.filter(function(s){ return !/\s/.test(s); });
    list=list.filter(function(v,i){ return list.indexOf(v)===i; });
    if(!list.length){ if(out) out.innerHTML='<span class="e">先输入模型 ID（每行一个，ID 里不能有空格）</span>'; return; }
    btn.disabled=true; if(out) out.textContent='添加中…';
    api('/admin/keys/'+id+'/models',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({models:list})}).then(function(r){
      btn.disabled=false;
      if(!r.ok){ if(out) out.innerHTML='<span class="e">添加失败 '+esc((r.body&&r.body.error&&r.body.error.message)||('错误 '+r.status))+'</span>'; return; }
      var note=bad.length?(' · 已跳过含空格的输入：'+esc(bad.join('、'))):'';
      if(out) out.innerHTML='<span class="k">已添加 '+(r.body.added||0)+' 个新模型（共提交 '+(r.body.total||0)+' 个）</span> · 下次探活会自动验证'+note;
      ta.value='';
      loadModelStatus();
      loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); });
    }).catch(function(){ btn.disabled=false; if(out) out.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- admin: users ----------------
  function loadUsers(){
    var tb=$('users-body');
    if(tb) tb.innerHTML='<tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr>';
    return api('/admin/users').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="5" style="color:var(--red)">加载失败 ('+r.status+') · <button class="btn ghost small" id="users-retry">重试</button></td></tr>'; var rb=$('users-retry'); if(rb) rb.onclick=loadUsers; var pb0=$('users-pending'); if(pb0) pb0.textContent=''; return; }
      var list = Array.isArray(r.body)? r.body : [];
      var pb=$('users-pending');
      if(pb){
        var pend=list.filter(function(u){return u.status==='pending';}).length;
        pb.className = pend>0 ? 'badge b-pending' : 'badge';
        pb.style.color = pend>0 ? '' : 'var(--faint)';
        pb.textContent = pend>0 ? ('待开通 '+pend) : '无待开通';
      }
      if(!list.length){ tb.innerHTML='<tr><td colspan="5" style="color:var(--faint)">还没有用户</td></tr>'; return; }
      tb.innerHTML = list.map(function(u){
        var bcls = u.status==='approved'?'b-approved':(u.status==='blocked'?'b-blocked':'b-pending');
        var action='';
        // never offer 停用 on an admin row — would let an admin lock themselves out.
        if(u.role==='admin') action='<span class="hint">管理员</span>';
        else if(u.status==='approved') action='<button class="btn ghost small" data-block="'+u.id+'">停用</button>';
        else if(u.status==='blocked') action='<button class="btn primary small" data-approve="'+u.id+'" data-was-blocked="1">恢复</button>';
        else action='<button class="btn primary small" data-approve="'+u.id+'">开通</button>';
        var hot = u.status==='pending' ? ' class="hot"' : '';
        return '<tr'+hot+'><td style="font-weight:700; word-break:break-all">'+esc(u.email||u.name||u.sub||'–')+'</td>'
          + '<td>'+esc(ROLE_CN[u.role]||u.role)+'</td>'
          + '<td><span class="badge '+bcls+'"'+(u.approved_at?' title="开通于 '+esc(fmtDate(u.approved_at))+'"':'')+'>'+esc(STATUS_CN[u.status]||u.status)+'</span></td>'
          + '<td style="color:var(--faint)">'+fmtDate(u.created_at)+'</td>'
          + '<td>'+action+'</td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-approve]'), function(b){
        b.onclick=function(){
          if(b.getAttribute('data-was-blocked') && !confirm('恢复该用户？其令牌仍为停用状态,需另行启用。')) return;
          b.disabled=true; api('/admin/users/'+b.getAttribute('data-approve')+'/approve',{method:'POST'}).then(function(r){ if(!r.ok){ b.disabled=false; return; } loadUsers(); }).catch(function(){ b.disabled=false; }); };
      });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-block]'), function(b){
        b.onclick=function(){ if(!confirm('停用该用户？其令牌会一并禁用。')) return; b.disabled=true;
          api('/admin/users/'+b.getAttribute('data-block')+'/block',{method:'POST'}).then(function(r){ if(!r.ok){ b.disabled=false; return; } loadUsers(); }).catch(function(){ b.disabled=false; }); };
      });
    }).catch(function(){ if(tb) tb.innerHTML='<tr><td colspan="5" style="color:var(--red)">网络错误</td></tr>'; var pb1=$('users-pending'); if(pb1) pb1.textContent=''; });
  }

  // ---------------- admin: tokens ----------------
  function loadAdminTokens(){
    var tb=$('adm-token-list');
    if(tb) tb.innerHTML='<tr><td colspan="10" style="color:var(--faint)">加载中…</td></tr>';
    return api('/admin/tokens').then(function(r){
      if(!r.ok){ tb.innerHTML='<tr><td colspan="10"><span class="e">错误 '+r.status+'</span></td></tr>'; return; }
      var list = Array.isArray(r.body)? r.body : [];
      if(!list.length){ tb.innerHTML='<tr><td colspan="10" style="color:var(--faint)">还没有</td></tr>'; return; }
      tb.innerHTML = list.map(function(t){
        return '<tr><td>'+t.id+'</td><td style="font-weight:700">'+esc(t.name||'–')+'</td>'
          + '<td><span class="badge">'+esc(ROLE_CN[t.role]||t.role)+'</span>'+(t.scope==='aliases'?' <span class="badge">仅映射</span>':'')+'</td>'
          + '<td>'+(t.owner_sub==null?'<span class="badge">全局</span>':'<span style="color:var(--faint)" title="'+esc(t.owner_sub)+'">…'+esc(String(t.owner_sub).slice(-8))+'</span>')+'</td>'
          + '<td class="n">'+t.used_requests+'/'+(t.quota_requests==null?'∞':t.quota_requests)+'</td>'
          + '<td class="n">'+(t.rpm_limit==null?'∞':t.rpm_limit)+'</td>'
          + '<td style="color:var(--faint)">'+(t.expires_at==null?'永久':fmtDate(t.expires_at))+'</td>'
          + '<td><span class="dot '+(t.enabled?'d-active':'d-disabled')+'"></span>'+(t.enabled?'启用':'停用')+'</td>'
          + '<td style="color:var(--faint)">'+fmtDate(t.created_at)+'</td>'
          + '<td><button class="btn ghost small" data-del="'+t.id+'">删除</button></td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-del]'), function(b){
        b.onclick = function(){
          if(!confirm('删除该令牌？使用方将立即被拒。')) return;
          b.disabled=true;
          api('/admin/tokens/'+b.getAttribute('data-del'),{method:'DELETE'}).then(function(r){ if(!r.ok){ b.disabled=false; return; } loadAdminTokens(); }).catch(function(){ b.disabled=false; });
        };
      });
    }).catch(function(){ if(tb) tb.innerHTML='<tr><td colspan="10"><span class="e">网络错误</span></td></tr>'; });
  }
  function mintAdmin(){
    var name=$('adm-tname').value.trim();
    var q=parseInt($('adm-quota').value,10), rpm=parseInt($('adm-rpm').value,10), exp=parseInt($('adm-exp').value,10);
    var role=$('adm-role').value;
    var scope=$('adm-scope').value;
    var payload={name:name};
    if(q>0) payload.quota_requests=q;
    if(rpm>0) payload.rpm_limit=rpm;
    if(exp>0) payload.expires_in_days=exp;
    if(scope==='aliases') payload.scope='aliases';
    if(role==='admin'){ if(!confirm('发放管理员令牌？该令牌可访问管理接口。')) return; payload.role='admin'; }
    var btn=$('adm-mint'); var lbl=btn.textContent; btn.disabled=true; btn.textContent='发放中…';
    api('/admin/tokens',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){ btn.disabled=false; btn.textContent=lbl; var o=$('adm-mint-out'); o.style.display='block';
      if(!r.ok){ o.innerHTML='<span class="e">错误 '+r.status+'</span>'; return; }
      o.innerHTML='新令牌(立即复制): <span class="k mono-token copyable" data-copy="'+esc(r.body.token)+'">'+esc(r.body.token)+'</span>';
      bindCopy(o); $('adm-tname').value=''; $('adm-quota').value=''; $('adm-rpm').value=''; $('adm-exp').value=''; loadAdminTokens();
    }).catch(function(){ btn.disabled=false; btn.textContent=lbl; });
  }

  // ---------------- model aliases ----------------
  function loadAliases(){
    var tb=$('alias-list');
    if(tb) tb.innerHTML='<tr><td colspan="5" style="color:var(--faint)">加载中…</td></tr>';
    return api('/admin/aliases').then(function(r){
      if(!r.ok){ if(tb) tb.innerHTML='<tr><td colspan="5"><span class="e">错误 '+r.status+'</span></td></tr>'; return; }
      var list = Array.isArray(r.body)? r.body : [];
      if(!list.length){ if(tb) tb.innerHTML='<tr><td colspan="5" style="color:var(--faint)">还没有映射</td></tr>'; return; }
      tb.innerHTML = list.map(function(a){
        var targets = Array.isArray(a.targets) ? a.targets : [];
        return '<tr><td style="font-weight:700">'+esc(a.alias)+'</td>'
          + '<td style="word-break:break-all">'+targets.map(function(t){ return esc(t); }).join('<br>')+'</td>'
          + '<td><span class="badge">'+(a.strategy==='loadbalance'?'负载均衡':'故障转移')+'</span></td>'
          + '<td><span class="dot '+(a.enabled?'d-active':'d-disabled')+'"></span>'+(a.enabled?'启用':'停用')+'</td>'
          + '<td><button class="btn ghost small" data-toggle="'+esc(a.alias)+'" data-enabled="'+(a.enabled?1:0)+'">'+(a.enabled?'停用':'启用')+'</button> '
          + '<button class="btn ghost small" data-edit="'+esc(a.alias)+'">编辑</button> '
          + '<button class="btn ghost small" data-delalias="'+esc(a.alias)+'">删除</button></td></tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('[data-toggle]'), function(b){
        b.onclick = function(){
          var alias=b.getAttribute('data-toggle');
          var enabled=b.getAttribute('data-enabled')!=='1';
          b.disabled=true;
          api('/admin/aliases/'+encodeURIComponent(alias)+'/enable',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:enabled})}).then(function(r){ b.disabled=false; if(r.ok) loadAliases(); }).catch(function(){ b.disabled=false; });
        };
      });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-edit]'), function(b){
        b.onclick = function(){
          var alias=b.getAttribute('data-edit');
          var row=list.filter(function(a){ return a.alias===alias; })[0];
          if(!row) return;
          $('alias-name').value=row.alias;
          $('alias-strategy').value=row.strategy||'failover';
          $('alias-targets').value=(Array.isArray(row.targets)?row.targets:[]).join('\n');
          window.scrollTo(0,0);
        };
      });
      Array.prototype.forEach.call(tb.querySelectorAll('[data-delalias]'), function(b){
        b.onclick = function(){
          var alias=b.getAttribute('data-delalias');
          if(!confirm('删除映射 '+alias+'？用这个映射名的调用将立即失败。')) return;
          b.disabled=true;
          api('/admin/aliases/'+encodeURIComponent(alias),{method:'DELETE'}).then(function(r){ b.disabled=false; if(r.ok) loadAliases(); }).catch(function(){ b.disabled=false; });
        };
      });
    }).catch(function(){ if(tb) tb.innerHTML='<tr><td colspan="5"><span class="e">网络错误</span></td></tr>'; });
  }
  function createAlias(){
    var name=$('alias-name').value.trim();
    var strategy=$('alias-strategy').value;
    var targets=$('alias-targets').value.split('\n').map(function(s){ return s.trim(); }).filter(function(s){ return s; });
    var out=$('alias-out'); out.style.display='block';
    if(!name){ out.innerHTML='<span class="e">先填映射名</span>'; return; }
    if(!targets.length){ out.innerHTML='<span class="e">先填至少一个目标模型</span>'; return; }
    var btn=$('alias-save'); var lbl=btn.textContent; btn.disabled=true; btn.textContent='保存中…';
    api('/admin/aliases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({alias:name,targets:targets,strategy:strategy})})
    .then(function(r){ btn.disabled=false; btn.textContent=lbl;
      if(!r.ok){ out.innerHTML='<span class="e">错误 '+r.status+(r.body&&r.body.error?': '+esc(r.body.error.message):'')+'</span>'; return; }
      out.innerHTML='已保存映射 '+esc(name)+'（'+targets.length+' 个目标 · '+(strategy==='loadbalance'?'负载均衡':'故障转移')+'）';
      $('alias-name').value=''; $('alias-targets').value=''; loadAliases();
    }).catch(function(){ btn.disabled=false; btn.textContent=lbl; out.innerHTML='<span class="e">网络错误</span>'; });
  }

  // ---------------- wire static handlers ----------------
  $('my-mint').onclick = mintMy;
  $('my-tokens-refresh').onclick = loadMyTokens;
  $('ov-refresh').onclick = function(){ var b=$('ov-refresh'); b.disabled=true; var po=$('ov-probe-out'); if(po) po.style.display='none'; loadStats('ov').then(function(){ b.disabled=false; }).catch(function(){ b.disabled=false; }); };
  $('ov-probe').onclick = probe;
  $('keys-refresh').onclick = function(){ loadStats('keys'); };
  $('keys-tokeylist').onclick = function(){ selectSection('keylist'); };
  $('modelstatus-refresh').onclick = loadModelStatus;
  $('modelstatus-probe').onclick = probeModels;
  $('pool-custom-add').onclick = poolCustomAdd;
  $('importBtn').onclick = importKeys;
  $('users-refresh').onclick = loadUsers;
  $('adm-mint').onclick = mintAdmin;
  $('adm-tokens-refresh').onclick = loadAdminTokens;
  $('alias-save').onclick = createAlias;
  $('aliases-refresh').onclick = loadAliases;
  $('bill-topup').onclick = topUp;
  $('bill-balances-refresh').onclick = loadBalances;
  $('bill-txns-refresh').onclick = loadBillingTxns;
  $('bill-txns-user').onchange = loadBillingTxns;
  $('prices-refresh').onclick = loadPrices;
  $('price-save').onclick = savePrice;
  $('bal-refresh').onclick = loadBalance;
  $('bal-topup-btn').onclick = checkout;
  (function(){ var c=$('bal-topup-chips'); if(c){ var bs=c.querySelectorAll('button'); for(var i=0;i<bs.length;i++){ bs[i].onclick=function(){ $('bal-topup-amount').value=this.getAttribute('data-amt'); }; } } })();
  $('pending-refresh').onclick = function(){ boot(); };

  // ---------------- boot / routing ----------------
  function showLanding(){
    // Don't call /v1/models here: it requires auth, so an unauthenticated
    // landing would 401 and the models card would stay hidden anyway.
    // Models appear after login, in the console.
    show('view-landing');
  }
  function showPending(){
    show('view-pending');
    $('pending-email').textContent = me.email || '';
    if(me.status==='blocked'){ $('pending-msg').textContent='账号已被停用，请联系管理员。'; }
  }
  function showConsole(){
    show('view-console');
    $('me-email').textContent = me.email || '';
    $('me-role').textContent = me.role;
    $('me-rolepill').className = 'pill ' + (me.role==='admin'?'ok':'');
    previewUser=false;
    buildNav(me.role);
    var pt=$('preview-toggle');
    if(pt){
      if(me.role==='admin'){
        pt.style.display='flex';
        pt.textContent='👤 预览用户视角';
        pt.onclick=function(){
          previewUser=!previewUser;
          pt.textContent = previewUser ? '↩ 回管理台' : '👤 预览用户视角';
          buildNav(previewUser ? 'user' : 'admin');
        };
      } else { pt.style.display='none'; }
    }
  }
  function boot(){
    return api('/auth/me').then(function(r){
      if(r.status===401 || !r.ok || !r.body || !r.body.role){
        // Token 登录回退：localStorage 里有 token 时用它验证管理员身份
        var tk=null; try{ tk=localStorage.getItem('kp_token'); }catch(e){}
        if(tk){
          return api('/admin/keys').then(function(a){
            if(a.ok){ me={ email:'Token 登录', role:'admin', status:'approved', sub:'token' }; showConsole(); }
            else { try{ localStorage.removeItem('kp_token'); }catch(e){} me=null; showLanding(); }
          }).catch(function(){ me=null; showLanding(); });
        }
        me=null; showLanding(); return;
      }
      me = r.body; // { email, role, status, sub }
      if(me.role==='admin'){ showConsole(); return; }
      if(me.status==='approved'){ showConsole(); return; }
      showPending();
    }).catch(function(){ me=null; showLanding(); });
  }
  var tokIn=$('tok-in');
  if(tokIn){
    try{ tokIn.value = localStorage.getItem('kp_token')||''; }catch(e){}
    $('tok-login').onclick=function(){
      var t=(tokIn.value||'').trim();
      if(!t){ tokIn.focus(); return; }
      try{ localStorage.setItem('kp_token', t); }catch(e){}
      boot();
    };
    tokIn.addEventListener('keydown', function(ev){ if(ev.key==='Enter') $('tok-login').click(); });
  }

  // ---- iOS 27 (Liquid Glass) 主题：深色 / 浅色切换（localStorage 持久化） ----
  function applyTheme(mode){
    var root=document.documentElement;
    if (mode === 'dark') { root.setAttribute('data-theme','dark'); }
    else if (mode === 'light') { root.setAttribute('data-theme','light'); }
    else {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) root.setAttribute('data-theme','dark');
      else root.setAttribute('data-theme','light');
    }
    var icon = root.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
    ['theme-toggle-landing','theme-toggle-side','theme-toggle-pending'].forEach(function(id){
      var b=$(id); if(b) b.innerHTML = icon + ' ' + (root.getAttribute('data-theme')==='dark' ? '浅色' : '深色');
    });
  }
  function toggleTheme(){
    var root=document.documentElement;
    var cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try{ localStorage.setItem('kp_theme', cur); }catch(e){}
    applyTheme(cur);
  }
  try{
    var saved = localStorage.getItem('kp_theme');
    applyTheme(saved || 'auto');
  }catch(e){ applyTheme('auto'); }
  ['theme-toggle-landing','theme-toggle-side','theme-toggle-pending'].forEach(function(id){
    var b=$(id); if(b) b.onclick=toggleTheme;
  });

  // ---------------- admin: add key with model selection ----------------
  var modalAddKey = $('modalAddKey');
  if (modalAddKey) {
    var addProvider = $('addProvider');
    var addKey = $('addKey');
    var modelList = $('modelList');
    var addConfirm = $('addConfirm');
    var addCancel = $('addCancel');
    var importSelectBtn = $('importSelectBtn');
    var modelSearch = $('modelSearch');
    var modelCount = $('modelCount');

    async function loadProviders() {
      var r = await api('/admin/providers');
      // Custom services need a base URL, which provider:key import can't
      // express — they go through Key 池「添加自定义服务」 instead.
      var list = ((r.body && r.body.providers) || []).filter(function(p){ return p !== 'custom'; });
      addProvider.innerHTML = list.map(function(p){ return '<option value="'+p+'">'+p+'</option>'; }).join('');
      if (list.length) onProviderChange();
    }
    var allModels = [];
    var provSeq = 0; // stale-response guard: a slow live-models fetch for the
    // previous provider must not overwrite the current provider's list.
    async function onProviderChange() {
      var p = addProvider.value;
      if (!p) return;
      var seq = ++provSeq;
      var key = addKey.value.trim();
      modelSearch.value = '';
      if (key) {
        // 优先用用户输入的 key 去上游实时拉取
        modelList.innerHTML = '<div class="hint">正在用输入的 Key 向 '+p+' 上游拉取模型列表…</div>';
        var r = await api('/admin/providers/'+encodeURIComponent(p)+'/live-models', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key: key })
        });
        if (seq !== provSeq) return;
        if (r.ok && r.body && Array.isArray(r.body.models) && r.body.models.length) {
          allModels = r.body.models;
        } else {
          // 降级静态列表
          var s = await api('/admin/providers/'+encodeURIComponent(p)+'/models');
          if (seq !== provSeq) return;
          allModels = (s.body && s.body.models) || [];
          var st = modelCount; if (st) st.textContent = '实时拉取失败，已回退内置列表：' + ((r.body && r.body.error && r.body.error.message) || r.status);
        }
      } else {
        var r2 = await api('/admin/providers/'+encodeURIComponent(p)+'/models');
        if (seq !== provSeq) return;
        allModels = (r2.body && r2.body.models) || [];
      }
      renderModels();
    }
    function renderModels() {
      var q = (modelSearch.value || '').trim().toLowerCase();
      var shown = q
        ? allModels.filter(function(m){ return m.toLowerCase().includes(q); })
        : allModels;
      modelList.innerHTML = shown.length
        ? shown.map(function(m){
            return '<label style="display:block;margin:4px 0"><input type="checkbox" value="'+esc(m)+'" checked> '+esc(m)+'</label>';
          }).join('')
        : '<div class="hint">没有匹配的模型</div>';
      modelCount.textContent = q ? ('显示 '+shown.length+' / '+allModels.length+' 个') : ('共 '+allModels.length+' 个模型');
    }
    addProvider.onchange = function(){
      // A key belongs to one provider — switching providers with the old
      // key still in the box would probe the new provider with it.
      addKey.value='';
      onProviderChange();
    };
    modelSearch.oninput = renderModels;
    var liveTimer = null;
    addKey.oninput = function(){
      clearTimeout(liveTimer);
      liveTimer = setTimeout(function(){
        if (addKey.value.trim() && addProvider.value) onProviderChange();
      }, 600);
    };
    addCancel.onclick = function(){ modalAddKey.style.display='none'; };
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && modalAddKey.style.display !== 'none') modalAddKey.style.display = 'none'; });
    importSelectBtn.onclick = function(){ modalAddKey.style.display='block'; loadProviders(); };
    addConfirm.onclick = async function(){
      var p = addProvider.value;
      var k = addKey.value.trim();
      if (!k) { addKey.focus(); return; }
      var checked = Array.from(modelList.querySelectorAll('input[type=checkbox]:checked')).map(function(cb){ return cb.value; });
      // 立刻在弹窗内给反馈：请求可能要几秒（批量导入几百个模型），而结果行
      // 在弹窗背后的页面上——没有这行，点完看起来像没反应。
      addConfirm.disabled = true; addConfirm.textContent = '导入中…';
      var st = $('addStatus'); if (st) { st.style.display = 'block'; st.textContent = '导入中…'; }
      var r = await api('/admin/keys/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider:p, api_key:k, models:checked }) });
      var o = $('importOut'); o.style.display='block';
      if (!r.ok) {
        var msg = '<span class="e">'+esc((r.body && r.body.error && r.body.error.message)||('错误 '+r.status))+'</span>';
        if (st) st.innerHTML = msg; // 失败也要写在弹窗里——importOut 在弹窗背后，看不见
        o.innerHTML = msg;
        addConfirm.disabled = false; addConfirm.textContent = '确认导入';
        return;
      }
      modalAddKey.style.display='none';
      addConfirm.disabled = false; addConfirm.textContent = '确认导入';
      if (st) st.style.display = 'none';
      addKey.value = '';
      o.innerHTML = '<span class="k">新增 '+(r.body.added||0)+'</span> 重复 '+(r.body.duplicate||0)+' · 已启用 '+(r.body.selected||[]).length+' 个模型 · 已屏蔽 '+(r.body.blocked||[]).length+' 个';
      loadStats('keys'); loadStats('ov');
    };
  }

  // 自定义 OpenAI 兼容服务（Key 池「添加自定义服务」）：服务名 + base URL +
  // key → 建 key → 拉取该服务的模型列表勾选添加（拉不到时可手动输入）。
  var csBtn = $('customServiceBtn');
  if (csBtn) {
    var csPanel = $('customServicePanel');
    var csSlug = $('csSlug'), csBaseUrl = $('csBaseUrl'), csKey = $('csKey');
    var csOut = $('csOut'), csModels = $('csModels'), csStatus = $('csStatus'), csList = $('csList');
    var csQ = $('csQ'), csAddSel = $('csAddSel'), csCustom = $('csCustom');
    var csKeyId = null, csFetched = [];
    csBtn.onclick = function(){
      csPanel.style.display = csPanel.style.display === 'none' ? 'block' : 'none';
      if (csPanel.style.display === 'block') csSlug.focus();
    };
    $('csCancel').onclick = function(){ csPanel.style.display = 'none'; };
    function csShowOut(html){ csOut.style.display = 'block'; csOut.innerHTML = html; }
    function csUpdateAddBtn(){
      var n = csList.querySelectorAll('input[type=checkbox]:checked').length;
      csAddSel.disabled = !n;
      csAddSel.textContent = n ? ('添加选中 ('+n+')') : '添加选中';
    }
    function csRenderList(){
      var needle = (csQ.value || '').trim().toLowerCase();
      var shown = needle ? csFetched.filter(function(m){ return m.id.toLowerCase().indexOf(needle) >= 0; }) : csFetched;
      csList.innerHTML = shown.length ? shown.map(function(m){
        return '<label style="display:block;margin:4px 0"><input type="checkbox" value="'+esc(m.id)+'"'+(m.isNew?' checked':'')+'> '+esc(m.id)+(m.isNew?' <span class="badge">新</span>':'')+'</label>';
      }).join('') : '<div class="hint">没有匹配的模型</div>';
      csUpdateAddBtn();
    }
    csList.addEventListener('change', csUpdateAddBtn);
    csQ.oninput = csRenderList;
    $('csAdd').onclick = function(){
      var slug = (csSlug.value || '').trim().toLowerCase();
      var base = (csBaseUrl.value || '').trim();
      var key = (csKey.value || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) { csShowOut('<span class="e">服务名须为小写字母/数字/连字符（1-32 字符），如 2api</span>'); csSlug.focus(); return; }
      if (!/^https?:\/\//i.test(base)) { csShowOut('<span class="e">API 地址须为 http(s) 地址，如 https://ai.example.com/v1</span>'); csBaseUrl.focus(); return; }
      if (!key) { csShowOut('<span class="e">先粘贴 API Key</span>'); csKey.focus(); return; }
      csShowOut('添加中…');
      api('/admin/keys/custom', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug:slug, base_url:base, api_key:key }) }).then(function(r){
        if (!r.ok) { csShowOut('<span class="e">'+esc((r.body && r.body.error && r.body.error.message)||('错误 '+r.status))+'</span>'); return; }
        csKeyId = r.body.id;
        var dup = r.body.duplicate ? '（该 key 已存在，直接拉取它的模型）' : '';
        csShowOut('<span class="k">服务 '+esc(slug)+' 已添加'+dup+'</span> · 正在拉取模型列表…');
        csModels.style.display = 'block';
        csStatus.textContent = '正在用该 key 向上游拉取模型列表…';
        api('/admin/keys/'+csKeyId+'/live-models', { method:'POST' }).then(function(r2){
          if (!r2.ok || !r2.body || !Array.isArray(r2.body.models)) {
            // 绿框状态行也要同步：之前拉取失败后它一直停在「正在拉取模型列表…」。
            csShowOut('<span class="k">服务 '+esc(slug)+' 已添加'+dup+'</span> · 拉取失败，可用下方手动输入添加模型');
            csStatus.innerHTML = '<span class="e">拉取失败 '+esc((r2.body && r2.body.error && r2.body.error.message)||('错误 '+r2.status))+'</span> · 可用下方手动输入添加模型';
            return;
          }
          var known = {}; (r2.body.known || []).forEach(function(m){ known[m] = 1; });
          csFetched = r2.body.models.map(function(m){ return { id:m, isNew:!known[m] }; });
          var nNew = csFetched.filter(function(m){ return m.isNew; }).length;
          csShowOut('<span class="k">服务 '+esc(slug)+' 已添加'+dup+'</span> · 已拉取 '+csFetched.length+' 个模型');
          csStatus.textContent = '共 '+csFetched.length+' 个模型 · 新模型 '+nNew+' 个已默认勾选（已有模型不勾选）';
          csRenderList();
        }).catch(function(){ csShowOut('<span class="k">服务 '+esc(slug)+' 已添加'+dup+'</span> · 拉取失败，可用下方手动输入添加模型'); csStatus.innerHTML = '<span class="e">网络错误</span> · 可用下方手动输入添加模型'; });
        loadStats('keys'); loadStats('ov');
      }).catch(function(){ csShowOut('<span class="e">网络错误</span>'); });
    };
    function csAddModels(list, done){
      if (!csKeyId) { csShowOut('<span class="e">先添加服务</span>'); return; }
      api('/admin/keys/'+csKeyId+'/models', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ models:list }) }).then(function(r){
        if (!r.ok) { csStatus.innerHTML = '<span class="e">添加失败 '+esc((r.body && r.body.error && r.body.error.message)||('错误 '+r.status))+'</span>'; csStatus.scrollIntoView({ block:'nearest' }); return; }
        // 成功提示原来只写在面板中部，点底部的「添加手动模型」时它在视口上方
        // 约一屏处，看不到。改写到导入卡片的输出行，并收起面板。
        var o = $('importOut');
        if (o) { o.style.display = 'block'; o.innerHTML = '<span class="k">自定义服务 '+esc((csSlug.value || '').trim().toLowerCase())+'：已添加 '+(r.body.added||0)+' 个新模型（共提交 '+(r.body.total||0)+' 个）</span> · 模型列表已刷新'; }
        csPanel.style.display = 'none';
        loadModels().then(function(){ renderModelsInto('models-body'); renderModelsInto('docs-models-body'); });
        if (done) done();
      }).catch(function(){ csStatus.innerHTML = '<span class="e">网络错误</span>'; csStatus.scrollIntoView({ block:'nearest' }); });
    }
    csAddSel.onclick = function(){
      var sel = Array.prototype.map.call(csList.querySelectorAll('input[type=checkbox]:checked'), function(cb){ return cb.value; });
      if (!sel.length) return;
      csAddSel.disabled = true; csStatus.textContent = '添加中…';
      csAddModels(sel, function(){ csAddSel.disabled = false; });
    };
    $('csAddCustom').onclick = function(){
      var typed = (csCustom.value || '').split(/[\n,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
      var bad = typed.filter(function(s){ return /\s/.test(s); });
      var list = typed.filter(function(s){ return !/\s/.test(s); });
      list = list.filter(function(v, i){ return list.indexOf(v) === i; });
      if (!list.length) { csStatus.innerHTML = '<span class="e">先输入模型 ID（每行一个，ID 里不能有空格）</span>'; return; }
      csStatus.textContent = '添加中…';
      csAddModels(list, function(){
        if (bad.length) { var o = $('importOut'); if (o) o.innerHTML += ' · 已跳过含空格的输入：' + esc(bad.join('、')); }
        csCustom.value = '';
      });
    };
  }

  boot();
})();
</script>
</body>
</html>`;

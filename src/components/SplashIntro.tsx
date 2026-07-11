"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// 起動スプラッシュ演出（MV風タイトルアニメ「TUAT / Track / Field」）。
// - 1セッション1回だけ再生（sessionStorage）。再生中に裏で各タブを router.prefetch する。
// - 未ログイン（Supabase の auth cookie 無し）のときはゆっくり再生（オーナー指定）。
// - アプリ側のCSSと衝突しないよう Shadow DOM に注入する。
//   アニメーションCSSはプロトタイプ C:\Users\rainb\video_repro_fix 由来（検証済みのものを移植）。

const SESSION_KEY = "tuat-splash-played";
const HOLD_MS = 1600; // 最後のピンクの余韻
const FADE_MS = 550;

const TAB_ROUTES = [
  "/home",
  "/schedule",
  "/timeline",
  "/members",
  "/notes",
  "/notices",
  "/ranking",
  "/venues",
  "/mypage",
];

const MARKUP = `
<style>
:host{--d:3.4s;--paper:#f5f4ee}
*{box-sizing:border-box}
.stage{position:relative;width:100%;height:100%;overflow:hidden;background:var(--paper);isolation:isolate;font-family:Arial Black,Arial,sans-serif;container-type:size}
.scene{position:absolute;inset:0;overflow:hidden}
.paper{background:linear-gradient(105deg,rgba(255,255,255,.84),rgba(235,244,244,.68)),url('/splash/paper.webp') center/cover;filter:saturate(.78) contrast(.92);animation:paper var(--d) linear forwards}
.paper:after{content:"";position:absolute;inset:-8%;background:url('/splash/paper.webp') center/cover;mix-blend-mode:multiply;opacity:.17;transform:rotate(180deg) scale(1.12);animation:brushDrift var(--d) ease-in-out forwards}
.film{position:absolute;inset:0;opacity:0;animation:film var(--d) linear forwards}
.mega{z-index:5;animation:megaScene var(--d) steps(1,end) forwards}
.black-row{position:absolute;display:block;inset:0;animation:megaDrift var(--d) cubic-bezier(.3,.1,.3,1) forwards}
.black-glyph{position:absolute;width:auto;height:auto;display:grid;place-items:center;color:#090909;font-weight:1000;line-height:.78;mix-blend-mode:multiply;font-size:76cqmin;overflow:visible;font-family:'Archivo Black','Arial Black',Arial,sans-serif;font-weight:900}
.black-glyph span{display:block;color:transparent;background:linear-gradient(#343434,#090909),url('/splash/paper.webp') center/cover;background-blend-mode:multiply;-webkit-background-clip:text;background-clip:text;filter:url(#roughG) contrast(1.12)}
.b-s{left:6%;top:2%;animation:blackLR var(--d) cubic-bezier(.68,.01,.18,1) forwards}
.b-t{left:50%;top:14%;animation:blackBT var(--d) cubic-bezier(.68,.01,.18,1) forwards}
.b-o{left:8%;top:44%;animation:blackTB var(--d) cubic-bezier(.68,.01,.18,1) forwards}
.b-r{left:52%;top:64%;animation:blackRL var(--d) cubic-bezier(.68,.01,.18,1) forwards}
.center{z-index:6;animation:centerScene var(--d) linear forwards}
.word-row{position:absolute;left:10%;right:10%;top:31%;height:39%;display:flex;align-items:center;justify-content:center;z-index:3}
.wipe{height:100%;width:auto;display:grid;place-items:center;overflow:visible;color:white;font-size:26cqmin;font-weight:900;line-height:.8;font-family:'Archivo Black','Arial Black',Arial,sans-serif}
.wipe span{display:block;color:transparent;background:#fff;-webkit-background-clip:text;background-clip:text;filter:url(#roughW)}
.w-s{animation:white1 var(--d) ease-in-out forwards}
.w-t{margin-left:-1cqw;animation:white2 var(--d) ease-in-out forwards}
.w-o{margin-left:-.5cqw;animation:white3 var(--d) ease-in-out forwards}
.w-r{margin-left:-.5cqw;animation:white4 var(--d) ease-in-out forwards}
.final{z-index:7;background:url('/splash/final-blue.webp') center/cover;filter:saturate(1.08) contrast(1.06);animation:finalScene var(--d) cubic-bezier(.5,.02,.16,1) forwards}
.final:before,.final:after{content:"";position:absolute;inset:-12%}
.final:before{background:url('/splash/mix.webp') center/cover;opacity:.4;animation:brushA var(--d) ease-out forwards}
.final:after{background:url('/splash/pink.webp') center/cover;opacity:0;animation:brushB var(--d) ease-out forwards}
.paint-title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:25cqmin;font-weight:1000;letter-spacing:-.09em;line-height:1;padding:.06em .16em;white-space:nowrap;width:max-content;color:transparent;background:url('/splash/final-blue.webp') center/cover;-webkit-background-clip:text;background-clip:text;filter:saturate(1.2) contrast(1.12) url(#roughW);z-index:4;animation:paintTitle var(--d) cubic-bezier(.2,.75,.2,1) forwards}
.paint-title:before,.paint-title:after{content:"TUAT";position:absolute;inset:0;padding:inherit;color:transparent;background-position:center;background-size:cover;-webkit-background-clip:text;background-clip:text}
.paint-title:before{background-image:url('/splash/mix.webp');animation:titleMix var(--d) linear forwards}
.paint-title:after{background-image:url('/splash/pink.webp');-webkit-text-stroke:.5px rgba(255,255,255,.2);animation:titlePink var(--d) linear forwards}
.flash{position:absolute;inset:0;z-index:20;background:white;pointer-events:none;opacity:0;animation:flash var(--d) linear forwards}
.stage:before{content:"";position:absolute;inset:-40%;z-index:25;pointer-events:none;opacity:.08;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.7'/%3E%3C/svg%3E");mix-blend-mode:soft-light;animation:grain .22s steps(2) infinite}
.paper,.film{will-change:transform}
.film{background:url('/splash/blue.webp') center/cover;filter:saturate(.82) brightness(.96) contrast(1.02)}
.film:after{content:"";position:absolute;inset:-14%;background:url('/splash/blue.webp') center/cover;filter:blur(16px) saturate(1.2);mix-blend-mode:screen;opacity:.28;animation:filmPar var(--d) linear forwards}
.frame-svg{position:absolute;left:50%;top:50%;width:168cqmin;height:94.5cqmin;transform:translate(-50%,-50%);z-index:3;overflow:visible;animation:frameHue 7s linear infinite alternate}
.frame-svg path{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:3400;stroke-dashoffset:3400;animation:frameDraw var(--d) cubic-bezier(.45,.05,.2,1) forwards}
.frame-svg .p1{stroke:url(#lcol);stroke-width:4.5}
.frame-svg .p2{stroke:url(#lcol);stroke-width:2.6;opacity:.85;animation-delay:.06s}
.frame-svg .p3{stroke:url(#lcol);stroke-width:2.8;filter:url(#fbrush);animation-delay:.04s}
.frame-svg .p4{stroke:rgba(106,72,196,.85);stroke-width:2.6;filter:url(#fbrush);animation-delay:.08s}
.frame-svg .p5{stroke:rgba(255,255,255,.8);stroke-width:1.8;animation-delay:.1s}
.credit{position:absolute;left:50%;top:calc(50% + 15cqmin);transform:translateX(-50%);z-index:4;font-family:'Archivo Black',Arial,sans-serif;font-size:3.2cqmin;letter-spacing:.3em;white-space:nowrap;color:transparent;background:linear-gradient(100deg,#6a48c4,#3f7ae0 20%,#d84a9c 40%,#47c4e8 60%,#8a5ad0 80%,#e878c0 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;filter:url(#roughS);animation:creditIn var(--d) linear forwards,creditFlow 5s ease-in-out infinite alternate}
@keyframes paper{0%{opacity:1;transform:scale(1.16) translate(2.2%,1.2%)}25%{opacity:1;transform:scale(1.05) translate(-1%,-.6%)}31%,100%{opacity:0;transform:scale(1.05) translate(-1%,-.6%)}}
@keyframes brushDrift{0%{transform:translate(-4%,-2%) rotate(180deg) scale(1.18)}25%,100%{transform:translate(5%,2%) rotate(180deg) scale(1.08)}}
@keyframes megaScene{0%,25%{visibility:visible}26%,100%{visibility:hidden}}
@keyframes megaDrift{0%{transform:scale(1.07) translate(1.6%,.9%)}25%,100%{transform:scale(1) translate(-1.2%,-.6%)}}
@keyframes blackLR{0%,1%{clip-path:inset(0 100% 0 0)}10%,18%{clip-path:inset(0)}25%,100%{clip-path:inset(0 0 0 100%)}}
@keyframes blackBT{0%,4%{clip-path:inset(0 0 100% 0)}13%,19%{clip-path:inset(0)}25%,100%{clip-path:inset(100% 0 0 0)}}
@keyframes blackTB{0%,7%{clip-path:inset(100% 0 0 0)}16%,20%{clip-path:inset(0)}25%,100%{clip-path:inset(0 0 100% 0)}}
@keyframes blackRL{0%,9%{clip-path:inset(0 0 0 100%)}18%,21%{clip-path:inset(0)}25%,100%{clip-path:inset(0 100% 0 0)}}
@keyframes film{0%,22%{opacity:0;transform:scale(1.18) translate(2.6%,1.6%)}27%{opacity:1}57%{opacity:1;transform:scale(1.04) translate(-1.2%,-.8%)}62%,100%{opacity:0;transform:scale(1.02) translate(-1.2%,-.8%)}}
@keyframes filmPar{0%,22%{transform:translate(-3%,2%) scale(1.08)}57%,100%{transform:translate(3.4%,-2%) scale(1.14)}}
@keyframes centerScene{0%,20%{opacity:0;transform:scale(1.1) translateX(2%)}25%{opacity:1}49%{opacity:1;transform:scale(1.01) translateX(-1%)}54%,100%{opacity:0;transform:scale(1)}}
@keyframes white1{0%,22%{clip-path:inset(0 100% 0 0)}28%,49%{clip-path:inset(0)}53%,100%{clip-path:inset(0 0 0 100%)}}
@keyframes white2{0%,27%{clip-path:inset(0 100% 0 0)}33%,49%{clip-path:inset(0)}53%,100%{clip-path:inset(0 0 0 100%)}}
@keyframes white3{0%,32%{clip-path:inset(0 100% 0 0)}38%,49%{clip-path:inset(0)}53%,100%{clip-path:inset(0 0 0 100%)}}
@keyframes white4{0%,37%{clip-path:inset(0 100% 0 0)}44%,49%{clip-path:inset(0)}53%,100%{clip-path:inset(0 0 0 100%)}}
@keyframes finalScene{0%,49%{opacity:1;clip-path:inset(0 0 0 100%);transform:scale(1.16) translateX(5%)}56%{clip-path:inset(0 0 0 48%)}64%{clip-path:inset(0);transform:scale(1.09) translateX(1%)}100%{opacity:1;clip-path:inset(0);transform:scale(1.015) translateX(-1.5%)}}
@keyframes brushA{0%,52%{transform:translate(14%,-5%) scale(1.18);opacity:0}65%{opacity:.56}81%{transform:translate(-2%,2%) scale(1.08);opacity:.82}100%{transform:translate(-7%,4%) scale(1.03);opacity:.18}}
@keyframes brushB{0%,62%{transform:translate(15%,-7%) scale(1.2);opacity:0}76%{opacity:.22}90%{opacity:.82}100%{transform:translate(-5%,3%) scale(1.03);opacity:1}}
@keyframes paintTitle{0%,51%{opacity:0;transform:translate(-50%,-50%) scale(1.14)}59%{opacity:1}76%,100%{opacity:1;transform:translate(-50%,-50%) scale(.82)}}
@keyframes titleMix{0%,60%{opacity:0}72%{opacity:.8}88%,100%{opacity:.18}}
@keyframes titlePink{0%,72%{opacity:0}86%{opacity:.65}100%{opacity:1}}
@keyframes flash{0%,46%,56%,100%{opacity:0}50%{opacity:.94}}
@keyframes grain{0%{transform:translate(-2%,1%)}25%{transform:translate(2%,-1%)}50%{transform:translate(1%,2%)}75%{transform:translate(-1%,-2%)}}
@keyframes frameDraw{0%,58%{stroke-dashoffset:3400;opacity:0}61%{opacity:1}76%,100%{stroke-dashoffset:0;opacity:1}}
@keyframes frameHue{from{filter:hue-rotate(-35deg)}to{filter:hue-rotate(45deg)}}
@keyframes creditIn{0%,64%{opacity:0}70%,100%{opacity:1}}
@keyframes creditFlow{from{background-position:0% 0}to{background-position:100% 0}}
</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="roughG" x="-8%" y="-8%" width="116%" height="116%">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.007" numOctaves="2" seed="5" result="n1"/>
    <feDisplacementMap in="SourceGraphic" in2="n1" scale="16" result="d1"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.06 0.08" numOctaves="2" seed="9" result="n2"/>
    <feDisplacementMap in="d1" in2="n2" scale="6"/>
  </filter>
  <filter id="roughW" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.011 0.018" numOctaves="2" seed="7" result="n1"/>
    <feDisplacementMap in="SourceGraphic" in2="n1" scale="9" result="d1"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.09 0.11" numOctaves="2" seed="3" result="n2"/>
    <feDisplacementMap in="d1" in2="n2" scale="4"/>
  </filter>
  <filter id="roughS" x="-12%" y="-12%" width="124%" height="124%">
    <feTurbulence type="fractalNoise" baseFrequency="0.08 0.12" numOctaves="2" seed="5" result="n1"/>
    <feDisplacementMap in="SourceGraphic" in2="n1" scale="2.2"/>
  </filter>
</svg>
<main class="stage">
  <section class="scene paper"></section><section class="scene film"></section>
  <section class="scene mega"><div class="black-row"><div class="black-glyph b-s"><span>T</span></div><div class="black-glyph b-t"><span>U</span></div><div class="black-glyph b-o"><span>A</span></div><div class="black-glyph b-r"><span>T</span></div></div></section>
  <section class="scene center"><div class="word-row"><div class="wipe w-s"><span>T</span></div><div class="wipe w-t"><span>U</span></div><div class="wipe w-o"><span>A</span></div><div class="wipe w-r"><span>T</span></div></div></section>
  <section class="scene final">
    <svg class="frame-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="frough" x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency="0.013 0.022" numOctaves="2" seed="8"/><feDisplacementMap in="SourceGraphic" scale="11"/></filter>
        <filter id="fbrush" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="6" result="n"/>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" result="d"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.09 0.35" numOctaves="3" seed="4" result="tex"/>
          <feColorMatrix in="tex" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 3 -0.4" result="mask"/>
          <feComposite in="d" in2="mask" operator="in"/>
        </filter>
        <linearGradient id="lcol" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="150" y2="95" spreadMethod="repeat">
          <stop offset="0" stop-color="#6a48c4"/><stop offset=".16" stop-color="#3f7ae0"/><stop offset=".28" stop-color="#8a5ad0"/><stop offset=".4" stop-color="#e878c0"/><stop offset=".5" stop-color="#47c4e8"/><stop offset=".62" stop-color="#5a3fb4"/><stop offset=".74" stop-color="#d84a9c"/><stop offset=".84" stop-color="#4a8ae4"/><stop offset=".93" stop-color="#f0ecf6"/><stop offset="1" stop-color="#6a48c4"/>
        </linearGradient>
      </defs>
      <g filter="url(#frough)" transform="rotate(-1 800 460)">
        <path class="p1" d="M 445 345 L 900 300 L 1145 285 M 1160 288 L 1245 330 L 1232 560 M 1228 566 L 1060 640 L 700 660 M 640 662 L 520 668 L 400 600 L 418 402 L 442 350"/>
        <path class="p2" d="M 430 358 L 890 312 M 1150 298 L 1236 342 M 1222 574 L 1052 652 L 530 678 M 408 610 L 426 408"/>
        <path class="p3" d="M 292 372 L 560 322 M 1108 246 L 1338 356 M 1296 252 L 1172 368 M 1258 276 L 1238 630"/>
        <path class="p4" d="M 252 778 L 388 742 M 402 738 L 560 700 M 300 828 L 452 788 M 470 782 L 618 742"/>
        <path class="p5" d="M 452 336 L 1148 276 M 1240 336 L 1226 556"/>
      </g>
    </svg>
    <div class="paint-title">TUAT</div><div class="credit">Track / Field</div>
  </section>
  <div class="flash"></div>
</main>
`;

export default function SplashIntro() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (
      sessionStorage.getItem(SESSION_KEY) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDone(true);
      return;
    }

    // ログイン済みかは Supabase の auth cookie の有無で判定（未ログインはゆっくり再生）
    const loggedIn = /sb-[^=;]*-auth-token/.test(document.cookie);
    const durMs = loggedIn ? 3400 : 5100;
    host.style.setProperty("--d", `${durMs}ms`);

    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = MARKUP;

    // 演出中に裏で各タブを先読み
    for (const route of TAB_ROUTES) {
      try {
        router.prefetch(route);
      } catch {
        // prefetch失敗は無視（演出を止めない）
      }
    }

    const fadeTimer = setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, "1");
      host.style.transition = `opacity ${FADE_MS}ms ease`;
      host.style.opacity = "0";
    }, durMs + HOLD_MS);
    const doneTimer = setTimeout(() => setDone(true), durMs + HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [router]);

  if (done) return null;
  return (
    <>
      {/* @font-face は Shadow DOM 内では読み込まれないため document 側に置く */}
      <style>{`@font-face{font-family:'Archivo Black';src:url('/splash/ArchivoBlack.woff2') format('woff2');font-weight:400 900;font-display:swap}`}</style>
      <div
        ref={hostRef}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#f5f4ee" }}
      />
    </>
  );
}

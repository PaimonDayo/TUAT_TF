// Usage: node ops/glass/build-vendor.mjs <pinned upstream checkout> <build dependencies>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const revision='9f1ca87d360d9a1c79a1f0e318ab804156c8f9c1';
const upstream=resolve(process.argv[2]), dependencies=resolve(process.argv[3]);
const require=createRequire(dependencies+'/package.json'), esbuild=require('esbuild');
if(esbuild.version!=='0.25.12'||require('html-to-image/package.json').version!=='1.11.11')throw Error('Use esbuild 0.25.12 and html-to-image 1.11.11');
const original=file=>execFileSync('git',['show',`${revision}:src/${file}`],{cwd:upstream,encoding:'utf8',maxBuffer:4*1024*1024});
let entry=original('web-component/index.ts');
entry=entry.replace('private ro?: ResizeObserver;','private ro?: ResizeObserver;\n  private resizeFrame = 0;');
entry=entry.replace('this.ro = new ResizeObserver(() => this.render());','this.ro = new ResizeObserver(() => { cancelAnimationFrame(this.resizeFrame); this.resizeFrame = requestAnimationFrame(() => { this.resizeFrame = 0; if (this.isConnected) this.render(); }); });');
entry=entry.replace('this.ro?.disconnect();','this.ro?.disconnect(); cancelAnimationFrame(this.resizeFrame);');
let runtime=original('core/webgl/runtime.ts');
const marker='sourceRect = new DOMRect(measured.left, elastic && !fixedSource ? documentTop - y : measured.top, measured.width, measured.height);';
if(!runtime.includes(marker))throw Error('Runtime source changed');
runtime=runtime.replace(marker,`${marker}
      const crop = shared?.capture.cache.get(source);
      if (crop) sourceRect = new DOMRect(sourceRect.left, sourceRect.top + crop.offsetTop, sourceRect.width, crop.cssHeight);
      if (shared && (!crop || lens.top - 20 < sourceRect.top || lens.bottom + 10 > sourceRect.bottom)) {
        if (ready) { ready = false; setStatus('pending'); }
        // CSS backdrop remains live until the new strip is ready.
        return;
      }`);
const overrides=new Map([
 ['web-component/index.ts',entry],['core/webgl/runtime.ts',runtime],
 ['core/webgl/source.ts',readFileSync(new URL('./source.js',import.meta.url),'utf8')],
]);
// html-to-image copies every computed property, including hundreds of Tailwind
// variables, into each SVG node. Resolved paint/layout values suffice here.
const paintProperties=`box-sizing display position top right bottom left z-index width height min-width min-height max-width max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius border-collapse border-spacing background-color background-image background-position background-size background-repeat background-origin background-clip background-blend-mode box-shadow opacity color fill fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity font-family font-size font-weight font-style font-variant font-stretch font-feature-settings line-height letter-spacing word-spacing text-align text-indent text-transform text-decoration text-shadow text-overflow white-space word-break overflow-wrap line-break direction writing-mode text-orientation flex-direction flex-wrap flex-grow flex-shrink flex-basis order justify-content justify-items justify-self align-content align-items align-self grid-template-columns grid-template-rows grid-auto-columns grid-auto-rows grid-auto-flow grid-column-start grid-column-end grid-row-start grid-row-end row-gap column-gap transform transform-origin translate rotate scale perspective overflow-x overflow-y clip-path object-fit object-position vertical-align float clear isolation filter visibility list-style-type list-style-position list-style-image table-layout`;
const clonePath=resolve(dependencies,'html-to-image/es/clone-node.js');
let clone=readFileSync(clonePath,'utf8');
if(!clone.includes('toArray(sourceStyle).forEach((name) => {'))throw Error('CSS clone source changed');
clone=clone.replace('toArray(sourceStyle).forEach((name) => {',`${JSON.stringify(paintProperties.split(' '))}.forEach((name) => {`);
// Load every upstream file from the pinned Git object, never working-tree edits.
await esbuild.build({stdin:{contents:entry,resolveDir:upstream+'/src/web-component',sourcefile:'web-component/index.ts',loader:'ts'},
 bundle:true,format:'iife',target:'safari15',minify:true,legalComments:'eof',nodePaths:[dependencies],
 plugins:[{name:'pinned-source',setup(build){
 build.onLoad({filter:/html-to-image[\\/]es[\\/]clone-node\.js$/},()=>({contents:clone,loader:'js',resolveDir:dirname(clonePath)}));
 build.onLoad({filter:/\.tsx?$/},args=>{
   const relative=args.path.replaceAll('\\','/').split('/src/')[1];
   if(!relative||!args.path.replaceAll('\\','/').startsWith(upstream.replaceAll('\\','/')))return;
   return {contents:overrides.get(relative)??original(relative),loader:relative.endsWith('.tsx')?'tsx':'ts',resolveDir:dirname(args.path)};
 });}}],outfile:resolve('public/vendor/liquid-glass/simple-liquid-glass.js')});
writeFileSync('public/vendor/liquid-glass/SOURCE.md',`# Vendored Liquid Glass\n\nSource: https://github.com/lucaperullo/simple-liquid-glass/tree/${revision}\n\nMIT. Optical shaders unchanged. TUAT patches: cancellable ResizeObserver render; bounded 384px bottom-viewport capture with offscreen subtree pruning; defer capture until input/navigation settles; crop-aware sampling with live CSS fallback outside the cached strip. System fonts only. html-to-image copies only resolved paint/layout properties instead of every computed CSS variable. Patch source and reproducible build are in ops/glass/. Build dependencies: esbuild 0.25.12, html-to-image 1.11.11; target safari15. Retained MIT notices beside this file.\n`);

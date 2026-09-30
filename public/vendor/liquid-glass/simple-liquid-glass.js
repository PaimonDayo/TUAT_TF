(()=>{var Ge=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
	v_uv = a_pos * 0.5 + 0.5;
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`,_t=`
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec2 v_uv;
void main() {
	gl_FragColor = texture2D(u_tex, v_uv * u_scale + u_offset);
}`,yt=`
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
varying vec2 v_uv;
void main() {
	vec4 s  = texture2D(u_tex, v_uv) * 0.227027;
	s += texture2D(u_tex, v_uv + u_dir * 1.0) * 0.194594;
	s += texture2D(u_tex, v_uv - u_dir * 1.0) * 0.194594;
	s += texture2D(u_tex, v_uv + u_dir * 2.0) * 0.121622;
	s += texture2D(u_tex, v_uv - u_dir * 2.0) * 0.121622;
	s += texture2D(u_tex, v_uv + u_dir * 3.0) * 0.054054;
	s += texture2D(u_tex, v_uv - u_dir * 3.0) * 0.054054;
	s += texture2D(u_tex, v_uv + u_dir * 4.0) * 0.016216;
	s += texture2D(u_tex, v_uv - u_dir * 4.0) * 0.016216;
	gl_FragColor = s;
}`,Xe=`
attribute vec2 a_pos;
uniform vec2 u_center;   // panel centre in root-pixel coords (top-left origin)
uniform vec2 u_size;     // panel size in px
uniform vec2 u_res;      // root element size in px
uniform float u_pad;     // shadow padding in px
varying vec2 v_localPx;
varying vec2 v_screenUV;

void main() {
	vec2 total = u_size + vec2(u_pad * 2.0);
	v_localPx = a_pos * total;                       // px from panel centre
	vec2 px = u_center + a_pos * total;              // screen px (DOM)
	v_screenUV = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y);
	vec2 ndc = (px / u_res) * 2.0 - 1.0;
	ndc.y = -ndc.y;
	gl_Position = vec4(ndc, 0.0, 1.0);
}`,wt=`
precision highp float;

uniform sampler2D u_bgTex;
uniform sampler2D u_blurTex;
uniform vec2 u_size;           // panel px
uniform float u_radius;        // corner radius px
uniform vec2 u_res;

uniform float u_refract;
uniform float u_chroma;
uniform float u_edgeHL;
uniform float u_spec;
uniform float u_fresnel;
uniform float u_distort;
uniform float u_alpha;
uniform float u_sat;
uniform float u_tint;
uniform float u_zRadius;
uniform float u_brightness;
uniform float u_shadowAlpha;
uniform float u_shadowSpread;
uniform float u_shadowOffY;
uniform float u_bevelMode;

varying vec2 v_localPx;
varying vec2 v_screenUV;

// Rounded-rect signed distance
float rrSDF(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + vec2(r);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Bevel height field.
// Both modes use the same half-circle profile (smooth peak at centre,
// steep at edges).  The difference is in the refraction model:
//   mode 0 = biconvex pill \u2014 light refracts at both surfaces (entry + exit).
//   mode 1 = dome (plano-convex) \u2014 flat bottom, so only exit refraction.
// d = distance inside from edge (-sdf), zR = z-radius of the bevel.
float bevelHeight(float d, float zR) {
	if (d <= 0.0) return 0.0;
	if (d >= zR) return zR;
	return sqrt(d * (2.0 * zR - d));
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
	vec2 half_ = u_size * 0.5;
	float r = min(u_radius, min(half_.x, half_.y));
	float sdf = rrSDF(v_localPx, half_, r);

	// \u2500\u2500 Shadow (outside panel, offset by shadowOffY) \u2500\u2500
	if (sdf > 0.0) {
		float sdfShadow = rrSDF(v_localPx - vec2(0.0, u_shadowOffY), half_, r);
		float d = max(sdfShadow - 1.0, 0.0);
		float spread = max(u_shadowSpread, 1.0);
		float falloff = 1.0 / (spread * spread);
		float outerShadow = exp(-d * d * falloff) * 0.65;
		float contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.35;
		float shadow = (outerShadow + contactShadow) * u_shadowAlpha;
		gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
		return;
	}

	// \u2500\u2500 Anti-aliased mask \u2500\u2500
	float mask = 1.0 - smoothstep(-1.5, 0.5, sdf);

	float maxD = min(half_.x, half_.y);
	float inside = -sdf;
	float edge = smoothstep(maxD * 0.35, 0.0, inside);

	// \u2500\u2500 Surface normal (top surface) via bevel height field \u2500\u2500
	float zR = u_zRadius;
	float e = 2.0;
	float dC = inside;
	float dR = -rrSDF(v_localPx + vec2(e, 0.0), half_, r);
	float dL = -rrSDF(v_localPx - vec2(e, 0.0), half_, r);
	float dU = -rrSDF(v_localPx + vec2(0.0, e), half_, r);
	float dD = -rrSDF(v_localPx - vec2(0.0, e), half_, r);
	float hC = bevelHeight(dC, zR);
	float hR = bevelHeight(dR, zR);
	float hL = bevelHeight(dL, zR);
	float hU = bevelHeight(dU, zR);
	float hD = bevelHeight(dD, zR);
	vec2 hGrad = vec2(hR - hL, hU - hD) / (2.0 * e);
	vec3 N = normalize(vec3(-hGrad, 1.0));

	float depth = smoothstep(0.0, zR, inside);

	// \u2500\u2500 Refraction \u2500\u2500
	vec2 pxToUV = vec2(1.0, -1.0) / u_res;
	float ior = 1.5;
	float refrPow = 1.0 - 1.0 / ior;
	float thickness = hC * 2.0;
	float thickNorm = thickness / max(zR * 2.0, 1.0);
	vec2 refrPx;
	if (u_bevelMode < 0.5) {
		// Biconvex: physically-based dual-surface refraction
		vec2 exitRefr = hGrad * refrPow;
		vec2 entryRefr = hGrad * refrPow;
		vec2 throughRefr = entryRefr * thickNorm * 0.5;
		refrPx = (exitRefr + entryRefr + throughRefr) * u_refract * 30.0;
		vec2 centerDir = -v_localPx / max(half_, vec2(1.0));
		refrPx += centerDir * u_refract * 4.0 * depth;
	} else {
		// Dome (plano-convex): uniform magnification by contracting UV toward center.
		// Each pixel samples from closer to center \u2192 content appears larger.
		refrPx = -v_localPx * u_refract * depth * 0.35;
	}
	vec2 refr = refrPx * pxToUV;

	// \u2500\u2500 Micro-distortion noise \u2500\u2500
	vec2 ns = v_localPx * 0.08;
	vec2 absPxToUV = vec2(1.0) / u_res;
	vec2 micro = (vec2(hash(ns), hash(ns + vec2(37.0))) - 0.5) * u_distort * 4.0 * absPxToUV;

	// \u2500\u2500 Chromatic aberration \u2500\u2500
	float caS = u_chroma * 18.0 * (edge * 0.7 + 0.3) * 2.0;
	vec2 caD = N.xy * caS * pxToUV;
	vec2 base = v_screenUV + refr + micro;

	vec3 sharp = vec3(
		texture2D(u_bgTex,  base + caD).r,
		texture2D(u_bgTex,  base).g,
		texture2D(u_bgTex,  base - caD).b
	);
	vec3 blur = vec3(
		texture2D(u_blurTex, base + caD).r,
		texture2D(u_blurTex, base).g,
		texture2D(u_blurTex, base - caD).b
	);
	// \u2500\u2500 Edge-weighted blur mix \u2500\u2500
	// Centre of the panel uses the blurred sample; the rim blends
	// toward the sharp sample so refraction edges stay crisp.
	float edgeMix = (1.0 - edge * 0.15);
	vec3 col = mix(sharp, blur, edgeMix);

	// \u2500\u2500 Brightness \u2500\u2500
	col *= 1.0 + u_brightness;

	// \u2500\u2500 Saturation \u2500\u2500
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	col = mix(vec3(lum), col, 1.0 + u_sat);

	// \u2500\u2500 Cool glass tint \u2500\u2500
	col = mix(col, col * vec3(0.92, 0.95, 1.05), u_tint);
	col *= 1.0 + 0.06 * depth;

	// \u2500\u2500 Fresnel \u2500\u2500
	float fres = pow(1.0 - abs(N.z), 4.0) * u_fresnel;

	// \u2500\u2500 Specular highlights (multi-light Blinn-Phong) \u2500\u2500
	vec3 V = vec3(0.0, 0.0, 1.0);
	vec3 L1 = normalize(vec3(0.4, 0.7, 1.0));
	vec3 H1 = normalize(L1 + V);
	float sp1 = pow(max(dot(N, H1), 0.0), 90.0);
	vec3 L2 = normalize(vec3(-0.3, -0.5, 1.0));
	vec3 H2 = normalize(L2 + V);
	float sp2 = pow(max(dot(N, H2), 0.0), 50.0) * 0.3;
	vec3 L3 = normalize(vec3(0.1, 0.3, 1.0));
	float spB = pow(max(dot(N, L3), 0.0), 6.0) * 0.1;
	vec3 L4 = normalize(vec3(0.0, 0.9, 0.4));
	vec3 H4 = normalize(L4 + V);
	float sp4 = pow(max(dot(N, H4), 0.0), 120.0) * 0.6;
	float totalSpec = (sp1 + sp2 + spB + sp4) * u_spec;

	// \u2500\u2500 Inner border / stroke highlight \u2500\u2500
	float borderWidth = 1.5;
	float innerStroke = smoothstep(-borderWidth - 1.0, -borderWidth, sdf)
	                  * (1.0 - smoothstep(-1.0, 0.0, sdf));
	float topBias = 0.5 + 0.5 * (-v_localPx.y / half_.y);
	innerStroke *= (0.4 + 0.6 * topBias);

	// \u2500\u2500 Edge highlight & inner glow \u2500\u2500
	float rim = edge * u_edgeHL * 0.22;
	float innerGlow = smoothstep(5.0, 0.0, -sdf) * u_edgeHL * 0.15;

	// \u2500\u2500 Environment-like reflection (fake) \u2500\u2500
	float envRefl = (N.y * 0.5 + 0.5) * fres * 0.08;

	// \u2500\u2500 Composite \u2500\u2500
	vec3 fin = col;
	fin += vec3(totalSpec);
	fin += vec3(rim + innerGlow);
	fin += vec3(innerStroke * u_edgeHL * 0.55);
	fin += vec3(envRefl);
	fin = mix(fin, vec3(1.0), fres * 0.2);

	gl_FragColor = vec4(fin, mask * u_alpha);
}`;var Et={blurAmount:0,refraction:.69,chromAberration:.05,edgeHighlight:.05,specular:0,fresnel:1,distortion:0,cornerRadius:65,zRadius:40,opacity:1,saturation:0,tintStrength:0,brightness:0,shadowOpacity:.3,shadowSpread:10,shadowOffsetY:1,floating:!1,button:!1,bevelMode:0},Ne=6,V=20;var ze=class{constructor(){this.fboCache=new Map;this.activeFBOs=null;this.bgTex=null;this.width=0;this.height=0;this.contextLost=!1;this.canvas=document.createElement("canvas"),this.canvas.style.display="none",this.cropCanvas=document.createElement("canvas"),this.cropCtx=this.cropCanvas.getContext("2d");let e=this.canvas.getContext("webgl",{alpha:!0,premultipliedAlpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!e)throw new Error("LiquidGlass: WebGL is not supported in this browser.");this.gl=e,this._initPrograms(),this._initBuffers(),this._onContextLost=n=>{n.preventDefault(),this.contextLost=!0,console.warn("LiquidGlass: WebGL context lost.")},this._onContextRestored=()=>{console.info("LiquidGlass: WebGL context restored \u2014 reinitialising."),this.contextLost=!1,this._initPrograms(),this._initBuffers();for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.activeFBOs=null,this.bgTex=null},this.canvas.addEventListener("webglcontextlost",this._onContextLost),this.canvas.addEventListener("webglcontextrestored",this._onContextRestored)}_initPrograms(){this.blitP=this._link(Ge,_t),this.blitU=this._uloc(this.blitP,["u_tex","u_scale","u_offset"]),this.blurP=this._link(Ge,yt),this.blurU=this._uloc(this.blurP,["u_tex","u_dir"]),this.glassP=this._link(Xe,wt),this.glassU=this._uloc(this.glassP,["u_bgTex","u_blurTex","u_center","u_size","u_radius","u_res","u_pad","u_refract","u_chroma","u_edgeHL","u_spec","u_fresnel","u_distort","u_alpha","u_sat","u_tint","u_zRadius","u_brightness","u_shadowAlpha","u_shadowSpread","u_shadowOffY","u_bevelMode"])}_initBuffers(){let e=this.gl;this.quadBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),this.panelBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.panelBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]),e.STATIC_DRAW)}resize(e,n){this.width=e,this.height=n;for(let r of this.fboCache.values())this._freeFBOSet(r);this.fboCache.clear(),this.activeFBOs=null,this.canvas.width=0,this.canvas.height=0}uploadAndBlur(e,n,r,s,i,a){if(this.contextLost)return;let o=this.gl;if(!this._setActiveSize(s,i))return;let l=this.width,d=this.height,c=this.activeFBOs,f=e;(n!==0||r!==0||e.width!==l||e.height!==d)&&((this.cropCanvas.width!==l||this.cropCanvas.height!==d)&&(this.cropCanvas.width=l,this.cropCanvas.height=d),this.cropCtx.clearRect(0,0,l,d),this.cropCtx.drawImage(e,-n,-r),f=this.cropCanvas),this.bgTex||(this.bgTex=o.createTexture()),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.bgTex),o.pixelStorei(o.UNPACK_FLIP_Y_WEBGL,!0),o.texImage2D(o.TEXTURE_2D,0,o.RGBA,o.RGBA,o.UNSIGNED_BYTE,f),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),o.pixelStorei(o.UNPACK_FLIP_Y_WEBGL,!1),o.bindFramebuffer(o.FRAMEBUFFER,c.bg.fbo),o.viewport(0,0,l,d),o.useProgram(this.blitP),o.activeTexture(o.TEXTURE0),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.bgTex),o.uniform1i(this.blitU.u_tex,0),o.uniform2f(this.blitU.u_scale,1,1),o.uniform2f(this.blitU.u_offset,0,0),this._drawQuad(this.blitP,this.quadBuf);let h=c.blurA.w,p=c.blurA.h;if(o.bindFramebuffer(o.FRAMEBUFFER,c.blurA.fbo),o.viewport(0,0,h,p),o.bindTexture(o.TEXTURE_2D,c.bg.tex),this._drawQuad(this.blitP,this.quadBuf),a>0){let b=a*2.5;o.useProgram(this.blurP),o.uniform1i(this.blurU.u_tex,0);for(let g=0;g<Ne;g++)o.bindFramebuffer(o.FRAMEBUFFER,c.blurB.fbo),o.viewport(0,0,h,p),o.bindTexture(o.TEXTURE_2D,c.blurA.tex),o.uniform2f(this.blurU.u_dir,b/h,0),this._drawQuad(this.blurP,this.quadBuf),o.bindFramebuffer(o.FRAMEBUFFER,c.blurA.fbo),o.bindTexture(o.TEXTURE_2D,c.blurB.tex),o.uniform2f(this.blurU.u_dir,0,b/p),this._drawQuad(this.blurP,this.quadBuf)}}renderGlassPanel(e,n,r,s){if(this.contextLost)return;let i=this.gl,a=this.width,o=this.height,l=this.activeFBOs;i.enable(i.BLEND),i.blendFunc(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA),i.useProgram(this.glassP),i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,l.bg.tex),i.uniform1i(this.glassU.u_bgTex,0),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,l.blurA.tex),i.uniform1i(this.glassU.u_blurTex,1),i.bindFramebuffer(i.FRAMEBUFFER,null),i.viewport(0,this.canvas.height-o,a,o),i.uniform2f(this.glassU.u_res,a,o),i.uniform2f(this.glassU.u_center,a*.5,o*.5),i.uniform2f(this.glassU.u_size,n*s,r*s),i.uniform1f(this.glassU.u_radius,e.cornerRadius*s),i.uniform1f(this.glassU.u_pad,V*s),i.uniform1f(this.glassU.u_refract,e.refraction),i.uniform1f(this.glassU.u_chroma,e.chromAberration),i.uniform1f(this.glassU.u_edgeHL,e.edgeHighlight),i.uniform1f(this.glassU.u_spec,e.specular),i.uniform1f(this.glassU.u_fresnel,e.fresnel),i.uniform1f(this.glassU.u_distort,e.distortion),i.uniform1f(this.glassU.u_alpha,e.opacity),i.uniform1f(this.glassU.u_sat,e.saturation),i.uniform1f(this.glassU.u_tint,e.tintStrength),i.uniform1f(this.glassU.u_zRadius,e.zRadius*s),i.uniform1f(this.glassU.u_brightness,e.brightness),i.uniform1f(this.glassU.u_shadowAlpha,e.shadowOpacity),i.uniform1f(this.glassU.u_shadowSpread,e.shadowSpread*s),i.uniform1f(this.glassU.u_shadowOffY,e.shadowOffsetY*s),i.uniform1f(this.glassU.u_bevelMode,e.bevelMode),this._drawQuad(this.glassP,this.panelBuf),i.disable(i.BLEND)}clear(){let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,this.canvas.height-this.height,this.width,this.height),e.enable(e.SCISSOR_TEST),e.scissor(0,this.canvas.height-this.height,this.width,this.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.disable(e.SCISSOR_TEST)}destroy(){if(this.canvas.removeEventListener("webglcontextlost",this._onContextLost),this.canvas.removeEventListener("webglcontextrestored",this._onContextRestored),!this.contextLost){let e=this.gl;for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.bgTex&&e.deleteTexture(this.bgTex),e.deleteBuffer(this.quadBuf),e.deleteBuffer(this.panelBuf),e.deleteProgram(this.blitP),e.deleteProgram(this.blurP),e.deleteProgram(this.glassP)}this.canvas.remove()}_setActiveSize(e,n){if(e<=0||n<=0)return!1;this.width=e,this.height=n,(this.canvas.width!==e||this.canvas.height!==n)&&(this.canvas.width=e,this.canvas.height=n);let r=`${e}x${n}`,s=this.fboCache.get(r);if(!s){for(let i of this.fboCache.values())this._freeFBOSet(i);this.fboCache.clear(),s={bg:this._makeFBO(e,n),blurA:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2)),blurB:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2))},this.fboCache.set(r,s)}return this.activeFBOs=s,!0}_makeFBO(e,n){let r=this.gl,s=r.createTexture();r.bindTexture(r.TEXTURE_2D,s),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,e,n,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);let i=r.createFramebuffer();return r.bindFramebuffer(r.FRAMEBUFFER,i),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,s,0),r.bindFramebuffer(r.FRAMEBUFFER,null),{fbo:i,tex:s,w:e,h:n}}_freeFBO(e){if(!e)return;let n=this.gl;n.deleteFramebuffer(e.fbo),n.deleteTexture(e.tex)}_freeFBOSet(e){this._freeFBO(e.bg),this._freeFBO(e.blurA),this._freeFBO(e.blurB)}_compile(e,n){let r=this.gl,s=r.createShader(n);return r.shaderSource(s,e),r.compileShader(s),r.getShaderParameter(s,r.COMPILE_STATUS)?s:(console.error("LiquidGlass shader compile error:",r.getShaderInfoLog(s),e),null)}_link(e,n){let r=this.gl,s=r.createProgram();return r.attachShader(s,this._compile(e,r.VERTEX_SHADER)),r.attachShader(s,this._compile(n,r.FRAGMENT_SHADER)),r.linkProgram(s),r.getProgramParameter(s,r.LINK_STATUS)||console.error("LiquidGlass program link error:",r.getProgramInfoLog(s)),s}_uloc(e,n){let r=this.gl,s={};for(let i of n)s[i]=r.getUniformLocation(e,i);return s}_drawQuad(e,n){let r=this.gl,s=r.getAttribLocation(e,"a_pos");r.bindBuffer(r.ARRAY_BUFFER,n),r.enableVertexAttribArray(s),r.vertexAttribPointer(s,2,r.FLOAT,!1,0,0),r.drawArrays(r.TRIANGLE_STRIP,0,4)}};function Rt(t,e,n=()=>e.getBoundingClientRect()){let r=t.renderer,s=r.gl,i,a=null,o=null,l={},d=s.getParameter(s.MAX_TEXTURE_SIZE),c=r.uploadAndBlur.bind(r),f,h=()=>{i=void 0,a=null,o=null};r.canvas.addEventListener("webglcontextrestored",h);let p=()=>{r.canvas.removeEventListener("webglcontextrestored",h),a&&s.deleteTexture(a),o&&s.deleteProgram(o)},b=t.destroy.bind(t);return t.destroy=()=>{p(),b()},r.uploadAndBlur=(g,_,u,m,x,y)=>{if(!f)return c(g,_,u,m,x,y);if(r.contextLost||!r._setActiveSize(m,x))return;let E=r.activeFBOs;if(o||(o=r._link(Ge,`precision highp float;
        uniform sampler2D u_tex; uniform vec2 u_scale; uniform vec2 u_offset; varying vec2 v_uv;
        void main() { vec2 uv = v_uv * u_scale + u_offset;
          gl_FragColor = texture2D(u_tex, clamp(uv, vec2(0.0), vec2(1.0))); }`),l=r._uloc(o,["u_tex","u_scale","u_offset"])),s.bindFramebuffer(s.FRAMEBUFFER,E.bg.fbo),s.viewport(0,0,m,x),s.useProgram(o),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,a),s.uniform1i(l.u_tex,0),s.uniform2f(l.u_scale,f.w,f.h),s.uniform2f(l.u_offset,f.x,f.y),r._drawQuad(o,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,E.blurA.fbo),s.viewport(0,0,E.blurA.w,E.blurA.h),s.useProgram(r.blitP),s.bindTexture(s.TEXTURE_2D,E.bg.tex),s.uniform1i(r.blitU.u_tex,0),s.uniform2f(r.blitU.u_scale,1,1),s.uniform2f(r.blitU.u_offset,0,0),r._drawQuad(r.blitP,r.quadBuf),y>0){let W=y*2.5;s.useProgram(r.blurP),s.uniform1i(r.blurU.u_tex,0);for(let X=0;X<Ne;X++)s.bindFramebuffer(s.FRAMEBUFFER,E.blurB.fbo),s.bindTexture(s.TEXTURE_2D,E.blurA.tex),s.uniform2f(r.blurU.u_dir,W/E.blurA.w,0),r._drawQuad(r.blurP,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,E.blurA.fbo),s.bindTexture(s.TEXTURE_2D,E.blurB.tex),s.uniform2f(r.blurU.u_dir,0,W/E.blurA.h),r._drawQuad(r.blurP,r.quadBuf)}},(g,_)=>{if(f=void 0,!g)return!1;let u=t.capture.cache.get(e)?.canvas;if(!u||u.width>d||u.height>d||u.width*u.height*4>64*1024*1024||r.contextLost)return!1;u!==i&&(a||=s.createTexture(),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,a),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,1),s.texImage2D(s.TEXTURE_2D,0,s.RGBA,s.RGBA,s.UNSIGNED_BYTE,u),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,0),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAG_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE),i=u);let m=n();return f={x:(g.left-_-m.left)/m.width,y:1-(g.bottom+_-m.top)/m.height,w:(g.width+_*2)/m.width,h:(g.height+_*2)/m.height},!0}}var Mt=.22,hr=Math.sqrt(Math.PI),mr=t=>Math.tanh(hr*t),St=(t,e)=>e>0?(t-Math.sqrt(t*t-e*e))/e:0,pr=(t,e,n)=>{let r=Math.max(.01,Math.min(t,Math.min(e,n)-1)),s=(e*e+r*r)/(2*r),i=(n*n+r*r)/(2*r),a=St(s,e),o=St(i,n);return{Rx:s,Ry:i,scaleX:a>0?.5/a:1,scaleY:o>0?.5/o:1}},gr=(t,e,n)=>{let r=Math.min(t,e*.999);return r/Math.sqrt(e*e-r*r)*n};var Ve=t=>(.5+t)*255+.5|0,Tt=t=>127*t+128+.5|0,At=t=>{let e=null,n=null,r=null,s=null,i=-1/0,a=-1/0,o=-1/0,l=0,d=!0,c=null;return{generate(f){e||(e=document.createElement("canvas"),e.width=t,e.height=t,n=e.getContext("2d"),r=n.createImageData(t,t));let{lensHalfWidth:h,lensHalfHeight:p,borderRadius:b,depth:g,clipToShape:_,softEdge:u,sheenAngle:m=45,glow:x=0,glowSpread:y=1,glowFalloff:E=1.5,sheen:W=0,sheenWidth:X=3,sheenFalloff:$=1.5,curvature:R=0,splay:M=0,bend:J=0,bendWidth:ie=.16}=f,v=r.data,T=t>>1,N=Math.min(b,Math.min(h,p)),re=Math.min(h,p),I=Math.min(g*re,re-1),G=Math.max(0,h-I),Z=Math.max(0,p-I),U=Math.max(0,Math.min(b,Math.min(G,Z))),ee=I>0?Math.SQRT1_2/I:1e6,S=x>0||W>0,L=m*Math.PI/180,D=Math.cos(L),F=Math.sin(L),oe=X>0?1/X:0,P=1/Math.max(2,y*Math.min(h,p)),j=2*h/t,K=2*p/t,w=1/h,te=1/p,Se=R>0,ae=R*Math.min(h,p),ge=M>0,be=J>0,Te=1/Math.max(2,ie*Math.min(h,p)),xe=(C,B)=>C>0||B>0?Math.sqrt(C*C+B*B):0;if(Se&&((!c||Math.abs(ae-i)>.5||Math.abs(h-a)>1||Math.abs(p-o)>1)&&(c=pr(ae,h,p),i=ae,a=h,o=p,d=!0),l!==T&&(s=new Float32Array(T),l=T,d=!0),d)){let C=s,B=c,q=B.Rx*B.Rx,z=B.Rx*(1-.001);for(let O=0;O<T;O+=1){let he=-((O+.5)*j-h),ne=he<z?he:z;C[O]=ne/Math.sqrt(q-ne*ne)*B.scaleX}d=!1}let Fe=Se?s:null,$e=.5*Math.min(h,p),ve=$e>0?1/$e:0,_e=Math.SQRT1_2;for(let C=0;C<T;C+=1){let B=t-1-C,q=-((C+.5)*K-p),z=q-p+N,O=u?q-Z+U:0,he=Se&&Fe?gr(q,c.Ry,c.scaleY):q*te>1?1:q*te,ne=q*te>1?1:q*te,He=ge?Math.max(0,1-(p-q)*ve):0,Pe=C*t,le=B*t;for(let ce=0;ce<T;ce+=1){let ft=t-1-ce,ye=-((ce+.5)*j-h),Ce=ye-h+N,we=xe(Ce>0?Ce:0,z>0?z:0)+(Ce>z?Ce>0?0:Ce:z>0?0:z)-N,Ue=(Pe+ce)*4,De=(Pe+ft)*4,Be=(le+ce)*4,Oe=(le+ft)*4;if(_&&we>=0){for(let A of[Ue,De,Be,Oe])v[A]=128,v[A+1]=128,v[A+2]=128,v[A+3]=255;continue}let ue=Fe?Fe[ce]:ye*w>1?1:ye*w,de=he;if(ge){let A=He*M,se=Math.max(0,1-(h-ye)*ve)*M;if(A>.001||se>.001){let me=ue,fe=de;ue=me*(1-A),de=fe*(1-se);let pe=Math.sqrt(me*me+fe*fe),Ie=Math.sqrt(ue*ue+de*de);if(Ie>.001){let vt=pe/Ie;ue*=vt,de*=vt}}}let ke=1;if(u){let A=ye-G+U,se=xe(A>0?A:0,O>0?O:0)+(A>O?A>0?0:A:O>0?0:O)-U;ke=.5*(1+mr(se*ee))}let Ze=.5*ue*ke,et=.5*de*ke;if(be){let A=we<0?Math.max(0,1+we*Te):0;if(A>0){let se=Math.sqrt(ue*ue+de*de);if(se>1e-4){let me=6.75*A*A*(1-A),fe=.5*J*me*ke/se;Ze+=ue*fe,et+=de*fe}}}let Ee=0,Re=0;if(S){let A=ye*w>1?1:ye*w,se=Math.min(1,Math.abs(A*D+ne*F)*_e),me=Math.min(1,Math.abs(A*D-ne*F)*_e);if(W>0){let fe=we<0?Math.max(0,1+we*oe):0,pe=W*Math.pow(fe,$);Ee+=pe*(.16+.84*Math.pow(se,1.6)),Re+=pe*(.16+.84*Math.pow(me,1.6))}if(x>0){let pe=1-(we<0?Math.min(1,-we*P):1),Ie=x*Math.pow(pe*pe*(3-2*pe),E)*ke;Ee+=Ie*(.6+.4*se),Re+=Ie*(.6+.4*me)}Ee>1?Ee=1:Ee<-1&&(Ee=-1),Re>1?Re=1:Re<-1&&(Re=-1)}let ht=Ve(Ze),mt=Ve(-Ze),pt=Ve(et),gt=Ve(-et),bt=Tt(Ee),xt=Tt(Re);v[Ue]=ht,v[Ue+1]=pt,v[Ue+2]=bt,v[Ue+3]=255,v[De]=mt,v[De+1]=pt,v[De+2]=xt,v[De+3]=255,v[Be]=ht,v[Be+1]=gt,v[Be+2]=xt,v[Be+3]=255,v[Oe]=mt,v[Oe+1]=gt,v[Oe+2]=bt,v[Oe+3]=255}}return n.putImageData(r,0,0),e.toDataURL()},dispose(){e&&(e.width=0,e.height=0,e=null),n=null,r=null,s=null,c=null,i=-1/0,a=-1/0,o=-1/0,l=0,d=!0}}};var br=`precision highp float;
uniform sampler2D u_bgTex, u_blurTex, u_lensMap;
uniform vec2 u_size, u_res;
uniform float u_radius, u_alpha, u_mapScale, u_mapDispersion, u_mapSpecular, u_classic, u_saturation, u_additive, u_neutral;
uniform float u_shadowAlpha, u_shadowSpread, u_shadowOffY;
varying vec2 v_localPx, v_screenUV;
float sdf(vec2 p, vec2 b, float r) {vec2 q=abs(p)-b+vec2(r);return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;}
void main(){
 float d=sdf(v_localPx,u_size*.5,min(u_radius,min(u_size.x,u_size.y)*.5));
 if(d>0.0){float s=max(sdf(v_localPx-vec2(0.0,u_shadowOffY),u_size*.5,u_radius)-1.0,0.0);
 gl_FragColor=vec4(0.0,0.0,0.0,exp(-s*s/max(1.0,u_shadowSpread*u_shadowSpread))*u_shadowAlpha);return;}
 vec2 mapUV=v_localPx/u_size+.5;
 vec3 m=texture2D(u_lensMap,mapUV).rgb;
 vec2 delta=(mix(m.rg,m.rb,u_classic)-u_neutral)*vec2(1.0,-1.0)/u_res;
 float red=mix(u_mapScale*(1.0+u_mapDispersion),u_mapScale+u_mapDispersion,u_additive);
 float green=mix(u_mapScale*(1.0+u_mapDispersion*.5),u_mapScale,u_additive);
 float blue=mix(u_mapScale,u_mapScale-u_mapDispersion,u_additive);
 if(u_additive>.5 && u_classic<.5) blue=max(0.0,blue);
 vec4 rSample=texture2D(u_blurTex,v_screenUV+delta*red);
 vec4 gSample=texture2D(u_blurTex,v_screenUV+delta*green);
 vec4 bSample=texture2D(u_blurTex,v_screenUV+delta*blue);
 vec3 col=vec3(rSample.r,gSample.g,bSample.b);
 float sourceAlpha=max(rSample.a,max(gSample.a,bSample.a));
 col=mix(vec3(dot(col,vec3(.2126,.7152,.0722))),col,u_saturation);
 col+=max(0.0,m.b-128.0/255.0)*u_mapSpecular;
 gl_FragColor=vec4(clamp(col,0.0,1.0),u_alpha*sourceAlpha*(1.0-smoothstep(-1.5,.5,d)));
}`;function Lt(t,e){let n=t.renderer,r=n.gl,s=n.renderGlassPanel.bind(n),i=null,a=null,o="",l=0,d={},c={ready:!1,failed:!1,mapUploads:0,mapUrl:"",scale:0},f=()=>{i=null,a=null,o="",l++,c.ready=!1};n.canvas.addEventListener("webglcontextrestored",f);let h=t.destroy.bind(t);return t.destroy=()=>{l++,n.canvas.removeEventListener("webglcontextrestored",f),a&&r.deleteTexture(a),h()},n.renderGlassPanel=(p,b,g,_)=>{let u=e(),m=u.map;if(m!==o){o=m,c.failed=!1;let x=++l,y=new Image;y.onload=()=>{x!==l||n.contextLost||(a||=r.createTexture(),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,a),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,0),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,r.NONE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,r.RGBA,r.UNSIGNED_BYTE,y),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),c.ready=!0,c.mapUploads++,c.mapUrl=m,t.markChanged())},y.onerror=()=>{x===l&&(c.failed=!0,t.markChanged())},y.src=m}a&&(i||(i=n._link(Xe,br),r.deleteProgram(n.glassP),n.glassP=i,n.glassU=n._uloc(i,Object.keys(n.glassU)),d=n._uloc(i,["u_lensMap","u_mapScale","u_mapDispersion","u_mapSpecular","u_classic","u_saturation","u_additive","u_neutral"])),c.scale=u.scale,r.useProgram(i),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,a),r.uniform1i(d.u_lensMap,2),r.uniform1f(d.u_mapScale,c.scale*_),r.uniform1f(d.u_mapDispersion,(u.additiveDispersion??u.classic?_:Mt)*u.dispersion),r.uniform1f(d.u_mapSpecular,u.specular),r.uniform1f(d.u_classic,u.classic?1:0),r.uniform1f(d.u_saturation,u.saturation/100),r.uniform1f(d.u_additive,u.additiveDispersion??u.classic?1:0),r.uniform1f(d.u_neutral,u.neutralPoint??.5),s(p,b,g,_))},c}function Ft(t,e){if(t.match(/^[a-z]+:\/\//i))return t;if(t.match(/^\/\//))return window.location.protocol+t;if(t.match(/^[a-z]+:/i))return t;let n=document.implementation.createHTMLDocument(),r=n.createElement("base"),s=n.createElement("a");return n.head.appendChild(r),n.body.appendChild(s),e&&(r.href=e),s.href=t,s.href}var $t=(()=>{let t=0,e=()=>`0000${(Math.random()*36**4<<0).toString(36)}`.slice(-4);return()=>(t+=1,`u${e()}${t}`)})();function Q(t){let e=[];for(let n=0,r=t.length;n<r;n++)e.push(t[n]);return e}function Ye(t,e){let r=(t.ownerDocument.defaultView||window).getComputedStyle(t).getPropertyValue(e);return r?parseFloat(r.replace("px","")):0}function xr(t){let e=Ye(t,"border-left-width"),n=Ye(t,"border-right-width");return t.clientWidth+e+n}function vr(t){let e=Ye(t,"border-top-width"),n=Ye(t,"border-bottom-width");return t.clientHeight+e+n}function tt(t,e={}){let n=e.width||xr(t),r=e.height||vr(t);return{width:n,height:r}}function Pt(){let t,e;try{e=process}catch{}let n=e&&e.env?e.env.devicePixelRatio:null;return n&&(t=parseInt(n,10),Number.isNaN(t)&&(t=1)),t||window.devicePixelRatio||1}var Y=16384;function Ct(t){(t.width>Y||t.height>Y)&&(t.width>Y&&t.height>Y?t.width>t.height?(t.height*=Y/t.width,t.width=Y):(t.width*=Y/t.height,t.height=Y):t.width>Y?(t.height*=Y/t.width,t.width=Y):(t.width*=Y/t.height,t.height=Y))}function Me(t){return new Promise((e,n)=>{let r=new Image;r.decode=()=>e(r),r.onload=()=>e(r),r.onerror=n,r.crossOrigin="anonymous",r.decoding="async",r.src=t})}async function _r(t){return Promise.resolve().then(()=>new XMLSerializer().serializeToString(t)).then(encodeURIComponent).then(e=>`data:image/svg+xml;charset=utf-8,${e}`)}async function Ut(t,e,n){let r="http://www.w3.org/2000/svg",s=document.createElementNS(r,"svg"),i=document.createElementNS(r,"foreignObject");return s.setAttribute("width",`${e}`),s.setAttribute("height",`${n}`),s.setAttribute("viewBox",`0 0 ${e} ${n}`),i.setAttribute("width","100%"),i.setAttribute("height","100%"),i.setAttribute("x","0"),i.setAttribute("y","0"),i.setAttribute("externalResourcesRequired","true"),s.appendChild(i),i.appendChild(t),_r(s)}var k=(t,e)=>{if(t instanceof e)return!0;let n=Object.getPrototypeOf(t);return n===null?!1:n.constructor.name===e.name||k(n,e)};function yr(t){let e=t.getPropertyValue("content");return`${t.cssText} content: '${e.replace(/'|"/g,"")}';`}function wr(t){return Q(t).map(e=>{let n=t.getPropertyValue(e),r=t.getPropertyPriority(e);return`${e}: ${n}${r?" !important":""};`}).join(" ")}function Er(t,e,n){let r=`.${t}:${e}`,s=n.cssText?yr(n):wr(n);return document.createTextNode(`${r}{${s}}`)}function Dt(t,e,n){let r=window.getComputedStyle(t,n),s=r.getPropertyValue("content");if(s===""||s==="none")return;let i=$t();try{e.className=`${e.className} ${i}`}catch{return}let a=document.createElement("style");a.appendChild(Er(i,n,r)),e.appendChild(a)}function Bt(t,e){Dt(t,e,":before"),Dt(t,e,":after")}var Ot="application/font-woff",kt="image/jpeg",Rr={woff:Ot,woff2:Ot,ttf:"application/font-truetype",eot:"application/vnd.ms-fontobject",png:"image/png",jpg:kt,jpeg:kt,gif:"image/gif",tiff:"image/tiff",svg:"image/svg+xml",webp:"image/webp"};function Sr(t){let e=/\.([^./]*?)$/g.exec(t);return e?e[1]:""}function Ae(t){let e=Sr(t).toLowerCase();return Rr[e]||""}function Tr(t){return t.split(/,/)[1]}function qe(t){return t.search(/^(data:)/)!==-1}function nt(t,e){return`data:${e};base64,${t}`}async function st(t,e,n){let r=await fetch(t,e);if(r.status===404)throw new Error(`Resource "${r.url}" not found`);let s=await r.blob();return new Promise((i,a)=>{let o=new FileReader;o.onerror=a,o.onloadend=()=>{try{i(n({res:r,result:o.result}))}catch(l){a(l)}},o.readAsDataURL(s)})}var rt={};function Mr(t,e,n){let r=t.replace(/\?.*/,"");return n&&(r=t),/ttf|otf|eot|woff2?/i.test(r)&&(r=r.replace(/.*\//,"")),e?`[${e}]${r}`:r}async function Le(t,e,n){let r=Mr(t,e,n.includeQueryParams);if(rt[r]!=null)return rt[r];n.cacheBust&&(t+=(/\?/.test(t)?"&":"?")+new Date().getTime());let s;try{let i=await st(t,n.fetchRequestInit,({res:a,result:o})=>(e||(e=a.headers.get("Content-Type")||""),Tr(o)));s=nt(i,e)}catch(i){s=n.imagePlaceholder||"";let a=`Failed to fetch resource: ${t}`;i&&(a=typeof i=="string"?i:i.message),a&&console.warn(a)}return rt[r]=s,s}async function Ar(t){let e=t.toDataURL();return e==="data:,"?t.cloneNode(!1):Me(e)}async function Lr(t,e){if(t.currentSrc){let i=document.createElement("canvas"),a=i.getContext("2d");i.width=t.clientWidth,i.height=t.clientHeight,a?.drawImage(t,0,0,i.width,i.height);let o=i.toDataURL();return Me(o)}let n=t.poster,r=Ae(n),s=await Le(n,r,e);return Me(s)}async function Fr(t){var e;try{if(!((e=t?.contentDocument)===null||e===void 0)&&e.body)return await We(t.contentDocument.body,{},!0)}catch{}return t.cloneNode(!1)}async function $r(t,e){return k(t,HTMLCanvasElement)?Ar(t):k(t,HTMLVideoElement)?Lr(t,e):k(t,HTMLIFrameElement)?Fr(t):t.cloneNode(!1)}var Pr=t=>t.tagName!=null&&t.tagName.toUpperCase()==="SLOT";async function Cr(t,e,n){var r,s;let i=[];return Pr(t)&&t.assignedNodes?i=Q(t.assignedNodes()):k(t,HTMLIFrameElement)&&(!((r=t.contentDocument)===null||r===void 0)&&r.body)?i=Q(t.contentDocument.body.childNodes):i=Q(((s=t.shadowRoot)!==null&&s!==void 0?s:t).childNodes),i.length===0||k(t,HTMLVideoElement)||await i.reduce((a,o)=>a.then(()=>We(o,n)).then(l=>{l&&e.appendChild(l)}),Promise.resolve()),e}function Ur(t,e){let n=e.style;if(!n)return;let r=window.getComputedStyle(t);r.cssText?(n.cssText=r.cssText,n.transformOrigin=r.transformOrigin):["box-sizing","display","position","top","right","bottom","left","z-index","width","height","min-width","min-height","max-width","max-height","margin-top","margin-right","margin-bottom","margin-left","padding-top","padding-right","padding-bottom","padding-left","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","border-collapse","border-spacing","background-color","background-image","background-position","background-size","background-repeat","background-origin","background-clip","background-blend-mode","box-shadow","opacity","color","fill","fill-opacity","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stroke-opacity","font-family","font-size","font-weight","font-style","font-variant","font-stretch","font-feature-settings","line-height","letter-spacing","word-spacing","text-align","text-indent","text-transform","text-decoration","text-shadow","text-overflow","white-space","word-break","overflow-wrap","line-break","direction","writing-mode","text-orientation","flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis","order","justify-content","justify-items","justify-self","align-content","align-items","align-self","grid-template-columns","grid-template-rows","grid-auto-columns","grid-auto-rows","grid-auto-flow","grid-column-start","grid-column-end","grid-row-start","grid-row-end","row-gap","column-gap","transform","transform-origin","translate","rotate","scale","perspective","overflow-x","overflow-y","clip-path","object-fit","object-position","vertical-align","float","clear","isolation","filter","visibility","list-style-type","list-style-position","list-style-image","table-layout"].forEach(s=>{let i=r.getPropertyValue(s);k(t,HTMLIFrameElement)&&s==="display"&&i==="inline"&&(i="block"),s==="d"&&e.getAttribute("d")&&(i=`path(${e.getAttribute("d")})`),n.setProperty(s,i,r.getPropertyPriority(s))})}function Dr(t,e){k(t,HTMLTextAreaElement)&&(e.innerHTML=t.value),k(t,HTMLInputElement)&&e.setAttribute("value",t.value)}function Br(t,e){if(k(t,HTMLSelectElement)){let r=Array.from(e.children).find(s=>t.value===s.getAttribute("value"));r&&r.setAttribute("selected","")}}function Or(t,e){return k(e,Element)&&(Ur(t,e),Bt(t,e),Dr(t,e),Br(t,e)),e}async function kr(t,e){let n=t.querySelectorAll?t.querySelectorAll("use"):[];if(n.length===0)return t;let r={};for(let i=0;i<n.length;i++){let o=n[i].getAttribute("xlink:href");if(o){let l=t.querySelector(o),d=document.querySelector(o);!l&&d&&!r[o]&&(r[o]=await We(d,e,!0))}}let s=Object.values(r);if(s.length){let i="http://www.w3.org/1999/xhtml",a=document.createElementNS(i,"svg");a.setAttribute("xmlns",i),a.style.position="absolute",a.style.width="0",a.style.height="0",a.style.overflow="hidden",a.style.display="none";let o=document.createElementNS(i,"defs");a.appendChild(o);for(let l=0;l<s.length;l++)o.appendChild(s[l]);t.appendChild(a)}return t}async function We(t,e,n){return!n&&e.filter&&!e.filter(t)?null:Promise.resolve(t).then(r=>$r(r,e)).then(r=>Cr(t,r,e)).then(r=>Or(t,r)).then(r=>kr(r,e))}var It=/url\((['"]?)([^'"]+?)\1\)/g,Ir=/url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g,Gr=/src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;function qr(t){let e=t.replace(/([.*+?^${}()|\[\]\/\\])/g,"\\$1");return new RegExp(`(url\\(['"]?)(${e})(['"]?\\))`,"g")}function Wr(t){let e=[];return t.replace(It,(n,r,s)=>(e.push(s),n)),e.filter(n=>!qe(n))}async function Hr(t,e,n,r,s){try{let i=n?Ft(e,n):e,a=Ae(e),o;if(s){let l=await s(i);o=nt(l,a)}else o=await Le(i,a,r);return t.replace(qr(e),`$1${o}$3`)}catch{}return t}function Xr(t,{preferredFontFormat:e}){return e?t.replace(Gr,n=>{for(;;){let[r,,s]=Ir.exec(n)||[];if(!s)return"";if(s===e)return`src: ${r};`}}):t}function it(t){return t.search(It)!==-1}async function je(t,e,n){if(!it(t))return t;let r=Xr(t,n);return Wr(r).reduce((i,a)=>i.then(o=>Hr(o,a,e,n)),Promise.resolve(r))}async function Ke(t,e,n){var r;let s=(r=e.style)===null||r===void 0?void 0:r.getPropertyValue(t);if(s){let i=await je(s,null,n);return e.style.setProperty(t,i,e.style.getPropertyPriority(t)),!0}return!1}async function Nr(t,e){await Ke("background",t,e)||await Ke("background-image",t,e),await Ke("mask",t,e)||await Ke("mask-image",t,e)}async function zr(t,e){let n=k(t,HTMLImageElement);if(!(n&&!qe(t.src))&&!(k(t,SVGImageElement)&&!qe(t.href.baseVal)))return;let r=n?t.src:t.href.baseVal,s=await Le(r,Ae(r),e);await new Promise((i,a)=>{t.onload=i,t.onerror=a;let o=t;o.decode&&(o.decode=i),o.loading==="lazy"&&(o.loading="eager"),n?(t.srcset="",t.src=s):t.href.baseVal=s})}async function Vr(t,e){let r=Q(t.childNodes).map(s=>ot(s,e));await Promise.all(r).then(()=>t)}async function ot(t,e){k(t,Element)&&(await Nr(t,e),await zr(t,e),await Vr(t,e))}function Gt(t,e){let{style:n}=t;e.backgroundColor&&(n.backgroundColor=e.backgroundColor),e.width&&(n.width=`${e.width}px`),e.height&&(n.height=`${e.height}px`);let r=e.style;return r!=null&&Object.keys(r).forEach(s=>{n[s]=r[s]}),t}var qt={};async function Wt(t){let e=qt[t];if(e!=null)return e;let r=await(await fetch(t)).text();return e={url:t,cssText:r},qt[t]=e,e}async function Ht(t,e){let n=t.cssText,r=/url\(["']?([^"')]+)["']?\)/g,i=(n.match(/url\([^)]+\)/g)||[]).map(async a=>{let o=a.replace(r,"$1");return o.startsWith("https://")||(o=new URL(o,t.url).href),st(o,e.fetchRequestInit,({result:l})=>(n=n.replace(a,`url(${l})`),[a,l]))});return Promise.all(i).then(()=>n)}function Xt(t){if(t==null)return[];let e=[],n=/(\/\*[\s\S]*?\*\/)/gi,r=t.replace(n,""),s=new RegExp("((@.*?keyframes [\\s\\S]*?){([\\s\\S]*?}\\s*?)})","gi");for(;;){let l=s.exec(r);if(l===null)break;e.push(l[0])}r=r.replace(s,"");let i=/@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi,a="((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})",o=new RegExp(a,"gi");for(;;){let l=i.exec(r);if(l===null){if(l=o.exec(r),l===null)break;i.lastIndex=o.lastIndex}else o.lastIndex=i.lastIndex;e.push(l[0])}return e}async function Yr(t,e){let n=[],r=[];return t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach((i,a)=>{if(i.type===CSSRule.IMPORT_RULE){let o=a+1,l=i.href,d=Wt(l).then(c=>Ht(c,e)).then(c=>Xt(c).forEach(f=>{try{s.insertRule(f,f.startsWith("@import")?o+=1:s.cssRules.length)}catch(h){console.error("Error inserting rule from remote css",{rule:f,error:h})}})).catch(c=>{console.error("Error loading remote css",c.toString())});r.push(d)}})}catch(i){let a=t.find(o=>o.href==null)||document.styleSheets[0];s.href!=null&&r.push(Wt(s.href).then(o=>Ht(o,e)).then(o=>Xt(o).forEach(l=>{a.insertRule(l,s.cssRules.length)})).catch(o=>{console.error("Error loading remote stylesheet",o)})),console.error("Error inlining remote css file",i)}}),Promise.all(r).then(()=>(t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach(i=>{n.push(i)})}catch(i){console.error(`Error while reading CSS rules from ${s.href}`,i)}}),n))}function jr(t){return t.filter(e=>e.type===CSSRule.FONT_FACE_RULE).filter(e=>it(e.style.getPropertyValue("src")))}async function Kr(t,e){if(t.ownerDocument==null)throw new Error("Provided element is not within a Document");let n=Q(t.ownerDocument.styleSheets),r=await Yr(n,e);return jr(r)}async function Nt(t,e){let n=await Kr(t,e);return(await Promise.all(n.map(s=>{let i=s.parentStyleSheet?s.parentStyleSheet.href:null;return je(s.cssText,i,e)}))).join(`
`)}async function zt(t,e){let n=e.fontEmbedCSS!=null?e.fontEmbedCSS:e.skipFonts?null:await Nt(t,e);if(n){let r=document.createElement("style"),s=document.createTextNode(n);r.appendChild(s),t.firstChild?t.insertBefore(r,t.firstChild):t.appendChild(r)}}async function Qr(t,e={}){let{width:n,height:r}=tt(t,e),s=await We(t,e,!0);return await zt(s,e),await ot(s,e),Gt(s,e),await Ut(s,n,r)}async function Vt(t,e={}){let{width:n,height:r}=tt(t,e),s=await Qr(t,e),i=await Me(s),a=document.createElement("canvas"),o=a.getContext("2d"),l=e.pixelRatio||Pt(),d=e.canvasWidth||n,c=e.canvasHeight||r;return a.width=d*l,a.height=c*l,e.skipAutoScale||Ct(a),a.style.width=`${d}`,a.style.height=`${c}`,e.backgroundColor&&(o.fillStyle=e.backgroundColor,o.fillRect(0,0,a.width,a.height)),o.drawImage(i,0,0,a.width,a.height),a}var at=new WeakMap,lt=class{constructor(e){this.capture={cache:new Map};this.listeners=new Set;this.busy=!1;this.disposed=!1;this.dirty=!0;this.revision=0;this.quietUntil=0;this.schedule=()=>{this.disposed||(clearTimeout(this.timer),this.timer=setTimeout(()=>{this.timer=void 0,this.run()},220))};this.changed=()=>{this.dirty=!0,this.revision++,this.schedule()};this.interacting=()=>{this.quietUntil=performance.now()+240,this.schedule()};this.refresh=async()=>{this.changed()};this.element=e,this.observer=new MutationObserver(this.changed),this.observer.observe(e,{subtree:!0,childList:!0,characterData:!0,attributes:!0}),this.resize=new ResizeObserver(this.changed),this.resize.observe(e),e.addEventListener("load",this.changed,!0),e.addEventListener("input",this.changed,!0),document.addEventListener("pointerdown",this.interacting,!0),document.addEventListener("touchstart",this.interacting,{passive:!0,capture:!0}),document.addEventListener("click",this.interacting,!0),window.addEventListener("scroll",this.interacting,{passive:!0}),window.addEventListener("resize",this.changed),window.visualViewport?.addEventListener("resize",this.changed)}async run(){if(this.disposed||document.hidden)return;if(this.busy||performance.now()<this.quietUntil||document.querySelector('.glass-bar[data-pressing="true"],.ios-glass-nav [aria-busy="true"]')){this.schedule();return}let e=this.element.getBoundingClientRect(),n=window.visualViewport,r=n?n.offsetTop+n.height:innerHeight,s=this.capture.cache.get(this.element);if(!this.dirty&&s&&r-110>=e.top+s.offsetTop&&r+20<=e.top+s.offsetTop+s.cssHeight)return;let i=e.width,a=e.height;if(!i||!a)return;let o=Math.min(384,a),l=Math.max(0,Math.min(a-o,r-230-e.top)),d=e.top+l,c=d+o,f=this.revision,h=new WeakMap,p=b=>{if(b instanceof Element&&b.matches("script,style,.app-floating-action,[data-liquid-glass-ignore]"))return!1;let g=b.parentElement;if(!g||g===this.element)return!0;if(!h.has(g)){let _=g.getBoundingClientRect();h.set(g,_.height===0||_.bottom>=d-16&&_.top<=c+16)}return h.get(g)};this.busy=!0;try{let b=await Vt(this.element,{width:i,height:o,pixelRatio:Math.min(devicePixelRatio||1,1.5),fontEmbedCSS:"",filter:p,style:{height:`${a}px`,transform:`translateY(${-l}px)`,translate:"none",transformOrigin:"top left",position:"static",margin:"0"}});if(this.disposed||f!==this.revision){b.width=0;return}this.capture.cache.set(this.element,{canvas:b,w:b.width,h:b.height,offsetTop:l,cssHeight:o}),s&&(s.canvas.width=0),this.dirty=!1,this.listeners.forEach(g=>g())}catch(b){this.listeners.forEach(g=>g(b))}finally{this.busy=!1}}dispose(){this.disposed=!0,clearTimeout(this.timer),this.observer.disconnect(),this.resize.disconnect(),this.element.removeEventListener("load",this.changed,!0),this.element.removeEventListener("input",this.changed,!0),document.removeEventListener("pointerdown",this.interacting,!0),document.removeEventListener("touchstart",this.interacting,!0),document.removeEventListener("click",this.interacting,!0),window.removeEventListener("scroll",this.interacting),window.removeEventListener("resize",this.changed),window.visualViewport?.removeEventListener("resize",this.changed),this.capture.cache.forEach(e=>{e.canvas.width=0}),this.capture.cache.clear()}};function Yt(t,e){let n=at.get(t);n||(n=new lt(t),at.set(t,n)),n.listeners.add(e);let r=n;return{capture:r.capture,refresh:r.refresh,release(){r.listeners.delete(e),r.listeners.size||(r.dispose(),at.delete(t))}}}function jt(t){let e=!1;for(let n=t;n;n=n.parentElement){let r=getComputedStyle(n);if(e&&(r.transform!=="none"||r.perspective!=="none"||r.filter!=="none"))return!1;r.position==="fixed"&&(e=!0)}return e}function Kt(t,e,n,r,s){let i=new ze,a=r,o=!0,l=!1,d=0,c=n instanceof HTMLVideoElement?n:void 0,f=c??(n instanceof HTMLCanvasElement?n:void 0),h=!1,p=!1,b=U=>{l||s(U)},g=f?void 0:Yt(n,U=>{o=!0,U&&!g?.capture.cache.has(n)&&b("capture-failed")}),_={renderer:i,capture:g?.capture??{cache:new Map},markChanged:()=>{o=!0},destroy:()=>i.destroy()},u=n.getBoundingClientRect(),m=u.top+scrollY,x=jt(n),y=jt(t),E=document.createElement("div");E.style.cssText="position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none",E.setAttribute("aria-hidden","true"),document.body.append(E);let W=f?void 0:Rt(_,n,()=>u),X=Lt(_,()=>a),$=i.canvas;$.setAttribute("aria-hidden","true"),$.dataset.liquidGlassWebgl="",$.style.cssText=`display:block;position:absolute;left:-${V}px;top:-${V}px;pointer-events:none`,e.append($);let R=document.createElement("canvas"),M=R.getContext("2d"),J="",ie=-1,v=()=>{h=!1,b("webgl-unavailable")},T=()=>{o=!0,b("pending")};$.addEventListener("webglcontextlost",v),$.addEventListener("webglcontextrestored",T);let N=()=>{o=!0};c?.addEventListener("seeked",N),c?.addEventListener("loadeddata",N);let re=0,I,G=()=>{re++,l||(I=c.requestVideoFrameCallback(G))};c?.requestVideoFrameCallback&&(I=c.requestVideoFrameCallback(G));let Z=()=>{if(!l&&(d=requestAnimationFrame(Z),!(document.hidden||i.contextLost||p&&!o))){p=!1;try{let U=n.getBoundingClientRect(),ee=t.getBoundingClientRect(),S=scrollY,L=Math.max(0,document.documentElement.scrollHeight-innerHeight),D=S<0||S>L;D||(m=U.top+S),u=new DOMRect(U.left,D&&!x?m-S:U.top,U.width,U.height);let F=g?.capture.cache.get(n);if(F&&(u=new DOMRect(u.left,u.top+F.offsetTop,u.width,F.cssHeight)),g&&(!F||ee.top-20<u.top||ee.bottom+10>u.bottom)){h&&(h=!1,b("pending"));return}let oe=D&&y?E.getBoundingClientRect().top:0,P=new DOMRect(ee.left,ee.top-oe,ee.width,ee.height),j=t.offsetWidth,K=t.offsetHeight;if(!j||!K||!u.width||!u.height)return;let w=Math.min(devicePixelRatio||1,3),te=[P.left-u.left,P.top-u.top,u.width,u.height,j,K,P.width,P.height,w].join(":"),Se=I!==void 0?re:c?.currentTime??0;if(!o&&te===J&&Se===ie&&!(f instanceof HTMLCanvasElement)||c&&c.readyState<2)return;let ae=f??g?.capture.cache.get(n)?.canvas;if(!ae)return;let ge=Math.round((j+V*2)*w),be=Math.round((K+V*2)*w);$.style.width=`${j+V*2}px`,$.style.height=`${K+V*2}px`;let Te=P.width/j,xe=P.height/K,Fe=new DOMRect(P.left,P.top,P.width,P.height),$e=Te===1&&xe===1&&W?.(Fe,V);if(!$e&&W&&(Te!==1||xe!==1)&&W(void 0,V),!$e){R.width!==ge||R.height!==be?(R.width=ge,R.height=be):M.clearRect(0,0,ge,be);let ve=(u.left-P.left)/Te*w+V*w,_e=(u.top-P.top)/xe*w+V*w,C=u.width/Te*w,B=u.height/xe*w;if(f){let q=c?.videoWidth??f.width,z=c?.videoHeight??f.height;if(!q||!z)return;let O=getComputedStyle(n),he=C,ne=B;if(O.objectFit!=="fill"){let le=O.objectFit==="cover"?Math.max(C/q,B/z):O.objectFit==="none"?w:Math.min(C/q,B/z,O.objectFit==="scale-down"?w:1/0);he=q*le,ne=z*le}let He=O.objectPosition.split(" "),Pe=(le,ce)=>le.endsWith("%")?parseFloat(le)/100*ce:parseFloat(le)*w||0;M.save(),M.beginPath(),M.rect(ve,_e,C,B),M.clip(),M.drawImage(f,ve+Pe(He[0],C-he),_e+Pe(He[1]??"50%",B-ne),he,ne),M.restore()}else M.drawImage(ae,0,_e>0?0:ae.height-1,ae.width,1,ve,0,C,be),M.drawImage(ae,ve,_e,C,B)}i.uploadAndBlur(R,0,0,ge,be,Math.max(0,a.blur)/5),i.clear(),i.renderGlassPanel({...Et,cornerRadius:a.radius,shadowOpacity:0},j,K,w),o=!1,J=te,ie=Se,X.failed?(b("capture-failed"),h=!1):X.ready&&!h&&(h=!0,b("active"))}catch{p=!0,o=!1,h=!1,b("capture-failed")}}};return g&&!g.capture.cache.has(n)&&g.refresh().catch(()=>{}),d=requestAnimationFrame(Z),{update(U){a=U,o=!0},async refresh(){await g?.refresh(),o=!0},destroy(){l=!0,cancelAnimationFrame(d),$.removeEventListener("webglcontextlost",v),$.removeEventListener("webglcontextrestored",T),c?.removeEventListener("seeked",N),c?.removeEventListener("loadeddata",N),I!==void 0&&c?.cancelVideoFrameCallback(I),E.remove(),g?.release(),_.destroy(),R.width=0,R.height=0}}}function Qt(t,e){return!/Android/i.test(t)&&(/iPhone|iPad|iPod/i.test(t)||/Macintosh/i.test(t)&&e>1)}function Jt(t,e,n){return e!=="off"&&e!=="blur"&&(n||t==="webgl")}function Jr(t){let e=new Map;return{get(n){let r=e.get(n);return r!==void 0&&(e.delete(n),e.set(n,r)),r},set(n,r){if(e.has(n))e.delete(n);else if(e.size>=t){let s=e.keys().next().value;s!==void 0&&e.delete(s)}e.set(n,r)},get size(){return e.size}}}var Zr=64,Zt=Jr(Zr),er=t=>Zt.get(t),tr=(t,e)=>Zt.set(t,e);var rr={material:{strength:.05,specular:1,depth:.5,curvature:.3,bend:.45,bendWidth:.16,sheen:.32,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:.5,glow:.1},loupe:{strength:.14,specular:1.55,depth:.95,curvature:.5,bend:.4,bendWidth:.07,sheen:1.2,sheenWidth:3.5,sheenFalloff:1.7,sheenAngle:0,glowFalloff:.6,glow:.1},player:{strength:.16,specular:1,depth:.2,curvature:.55,bend:.25,bendWidth:.08,sheen:.95,sheenWidth:2,sheenFalloff:1.5,sheenAngle:50,glowFalloff:1.5,glow:.15},track:{strength:.03,specular:1,depth:.3,curvature:.25,bend:.05,bendWidth:.06,sheen:.35,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:1.5,glow:.1}},nr={strength:[0,.5],depth:[0,1],curvature:[0,1],bend:[0,1],bendWidth:[.001,.5],sheen:[0,2],sheenWidth:[0,10],sheenFalloff:[.1,5],sheenAngle:[-360,360],specular:[0,3],glow:[0,1],glowSpread:[.01,2],glowFalloff:[.1,5],brightness:[-1,1]};function ct(t="player",e={}){let n={...rr[t]??rr.player,glowSpread:1,brightness:0};for(let r of Object.keys(nr)){let s=e?.[r];if(typeof s=="number"&&Number.isFinite(s)){let[i,a]=nr[r];n[r]=Math.max(i,Math.min(a,s))}}return n}function sr(t,e,n,r="material",s){let{strength:i,specular:a,brightness:o,...l}=ct(r,s),d=`material-v2:${t}:${e}:${n}:${JSON.stringify(l)}`,c=er(d);if(c)return c;if(typeof document>"u")return"";let f=At(512);try{let h=f.generate({lensHalfWidth:t/2,lensHalfHeight:e/2,borderRadius:n,...l,clipToShape:!0,softEdge:!0});return tr(d,h),h}finally{f.dispose()}}function ut(t,e,n){if(typeof n=="number"&&Number.isFinite(n))return Math.max(0,Math.min(.45,n));if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return .06;let r=1.5*.5*t/e;return Math.max(.06,Math.min(.45,r))}function ir(t,e,n){if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return 1;let s=ut(t,e,n)*e;return Math.max(0,Math.min(1,s/(1.5*.5*t)))}var en=["classic","convex","shift","rim"];function or(t){return typeof t=="string"&&en.includes(t)}function tn(t,e,n,r){let s=Math.max(8,Math.round(t/n/r)*r),i=Math.max(8,Math.round(e/n/r)*r);return{newwidth:s,newheight:i}}function dt(t){let n=((typeof t=="number"&&Number.isFinite(t)?t:0)%360+360)%360;return Math.round(n*1e3)/1e3}function rn(t){let e=t!==0?` gradientTransform="rotate(${t} 0.5 0.5)"`:"";return`          <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>`}function nn(t,e,n){let r=t/2,s=e/2,i=Math.max(t,e),a=Math.round(255*t/i),o=Math.round(255*e/i),l=n!==0?` gradientTransform="rotate(${n} ${r} ${s})"`:"";return`          <linearGradient id="red" gradientUnits="userSpaceOnUse" x1="${t}" y1="${s}" x2="0" y2="${s}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(${a},0,0)"/>
          </linearGradient>
          <linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="${r}" y1="0" x2="${r}" y2="${e}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(0,0,${o})"/>
          </linearGradient>`}var sn=.3,on=.66,an=.42,ln=.5;function cn(t,e,n,r,s,i,a){let o=i*t,l=a*e,d=Math.max(8,Math.min(t,e)*on),c=s>0?Math.min(.5,sn*s):0,f=Math.round((.5+c)*255),h=Math.round((.5-c)*255),p=r!==0?` gradientTransform="rotate(${r} ${o} ${l})"`:"",b=c>0?`<linearGradient id="cvxRed" gradientUnits="userSpaceOnUse" x1="${o-d}" y1="${l}" x2="${o+d}" y2="${l}"${p}><stop offset="0%" stop-color="rgb(${f},0,0)"/><stop offset="100%" stop-color="rgb(${h},0,0)"/></linearGradient>`:'<linearGradient id="cvxRed"><stop offset="0%" stop-color="rgb(128,0,0)"/></linearGradient>',g=c>0?`<linearGradient id="cvxBlue" gradientUnits="userSpaceOnUse" x1="${o}" y1="${l-d}" x2="${o}" y2="${l+d}"${p}><stop offset="0%" stop-color="rgb(0,0,${f})"/><stop offset="100%" stop-color="rgb(0,0,${h})"/></linearGradient>`:'<linearGradient id="cvxBlue"><stop offset="0%" stop-color="rgb(0,0,128)"/></linearGradient>',_=`${b}
          ${g}
          <radialGradient id="cvxEnv" gradientUnits="userSpaceOnUse" cx="${o}" cy="${l}" r="${d}" fx="${o}" fy="${l}"><stop offset="0%" stop-color="#fff"/><stop offset="40%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>
          <mask id="cvxMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#cvxEnv)"/></mask>`,u=`<rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
        <g>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(128,0,0)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxRed)" mask="url(#cvxMask)"/>
        </g>
        <g style="mix-blend-mode: difference">
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(0,0,128)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxBlue)" mask="url(#cvxMask)"/>
        </g>`;return{defs:_,body:u}}function un(t,e,n,r,s,i){let a=s*Math.PI/180,o=Math.max(0,Math.min(.5,.5*ln*i)),l=Math.round((.5+o*Math.cos(a))*255),d=Math.round((.5+o*Math.sin(a))*255),c=Math.min(t,e)/2-.5,f=Math.max(1,Math.min(n,c/3)),h=`<mask id="shiftMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="black"/><rect x="${f}" y="${f}" width="${t-f*2}" height="${e-f*2}" rx="${Math.max(0,r-f)}" fill="white" style="filter:blur(${f}px)"/></mask>`,p=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="rgb(${l},0,${d})" mask="url(#shiftMask)"/>`;return{defs:h,body:p}}function dn(t,e,n,r,s,i,a,o){let l=a*t,d=o*e,c=Math.min(1,Math.max(0,i)),f=Math.round(127*an*c),h=Math.min(255,128+f),p=Math.max(0,128-f),b=Math.min(t,e)/2,g=Math.max(n*1.6,Math.min(t,e)*.4),u=(100*Math.max(0,b-g*c)/b).toFixed(2),m=s!==0?` gradientTransform="rotate(${s} ${l} ${d})"`:"",x=`<linearGradient id="rimRed" gradientUnits="userSpaceOnUse" x1="0" y1="${d}" x2="${t}" y2="${d}"${m}><stop offset="0%" stop-color="rgb(${p},0,0)"/><stop offset="50%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(${h},0,0)"/></linearGradient>
          <linearGradient id="rimBlue" gradientUnits="userSpaceOnUse" x1="${l}" y1="0" x2="${l}" y2="${e}"${m}><stop offset="0%" stop-color="rgb(0,0,${p})"/><stop offset="50%" stop-color="rgb(0,0,128)"/><stop offset="100%" stop-color="rgb(0,0,${h})"/></linearGradient>
          <radialGradient id="rimRadial" gradientUnits="userSpaceOnUse" cx="${l}" cy="${d}" r="${b}"${m}><stop offset="0%" stop-color="#000"/><stop offset="${u}%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></radialGradient>
          <mask id="rimMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#rimRadial)"/></mask>`,y=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <g mask="url(#rimMask)">
          <rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimRed)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimBlue)" style="mix-blend-mode: screen"/>
        </g>`;return{defs:x,body:y}}function fn(t){let{width:e,height:n,divisor:r,quantStep:s,radius:i,border:a,lightness:o,alpha:l,displace:d}=t,c=t.blend??"difference",f=dt(t.angle),h=t.shapeAdapt!==!1,p=t.lens??"classic",b=typeof t.lensStrength=="number"&&Number.isFinite(t.lensStrength)?Math.max(0,t.lensStrength):1,g=t.lensCenter?t.lensCenter[0]:.5,_=t.lensCenter?t.lensCenter[1]:.5,{newwidth:u,newheight:m}=tn(e,n,r,s),x=Math.min(u,m)*(a*.5),y=Math.min(i,e/2,n/2)/r;if(p!=="classic"){let $=`<rect x="${x}" y="${x}" width="${u-x*2}" height="${m-x*2}" rx="${y}" fill="hsl(0 0% ${o}% / ${l})" style="filter:blur(${d}px)" />`,R;p==="convex"?R=cn(u,m,y,f,b,g,_):p==="shift"?R=un(u,m,x,y,f,b):R=dn(u,m,x,y,f,b,g,_);let M=p==="rim"?R.body:`${R.body}
        ${$}`;return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${R.defs}
        </defs>
        ${M}
      </svg>
    `}let E=`<rect x="${x}" y="${x}" width="${u-x*2}" height="${m-x*2}" rx="${y}" fill="hsl(0 0% ${o}% / ${l})" style="filter:blur(${d}px)" />`;if(h){let $=nn(u,m,f),R=Math.min(e,n),M=Number.isFinite(t.scale)?t.scale:0,J=ut(M,R,t.edgeFeather),ie=ir(M,R,t.edgeFeather),v=Math.min(u,m),T=Math.max(.5,J*v),N=Math.max(0,y-T),re=Math.max(.5,T*.5),I=Math.max(.6,v*.01),G=ie<.999?` opacity="${Math.round(ie*1e3)/1e3}"`:"";return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${$}
          <mask id="clsEnv" maskUnits="userSpaceOnUse" x="0" y="0" width="${u}" height="${m}">
            <rect x="0" y="0" width="${u}" height="${m}" fill="#000"/>
            <rect x="${T}" y="${T}" width="${u-T*2}" height="${m-T*2}" rx="${N}" fill="white" style="filter:blur(${re}px)"/>
          </mask>
        </defs>
        <rect x="0" y="0" width="${u}" height="${m}" fill="rgb(128,128,128)"/>
        <g${G}>
          <g mask="url(#clsEnv)" style="filter:blur(${I}px)">
            <rect x="0" y="0" width="${u}" height="${m}" rx="${y}" fill="url(#red)" />
            <rect x="0" y="0" width="${u}" height="${m}" rx="${y}" fill="url(#blue)" style="mix-blend-mode: ${c}" />
          </g>
        </g>
        ${E}
      </svg>
    `}let W=rn(f),X=Math.max(.6,Math.min(u,m)*.01);return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${W}
        </defs>
        <rect x="0" y="0" width="${u}" height="${m}" fill="black"/>
        <g style="filter:blur(${X}px)">
          <rect x="0" y="0" width="${u}" height="${m}" rx="${y}" fill="url(#red)" />
          <rect x="0" y="0" width="${u}" height="${m}" rx="${y}" fill="url(#blue)" style="mix-blend-mode: ${c}" />
        </g>
        ${E}
      </svg>
    `}function ar(t){return`data:image/svg+xml,${encodeURIComponent(fn(t))}`}var hn=["ripple","flow","wobble"];function cr(t){return typeof t=="string"&&hn.includes(t)}var Qe={ripple:{baseFrequencyX:.012,baseFrequencyY:.012,numOctaves:2,scale:15,seed:3,ampX:.004,ampY:.004,rateX:1.3,rateY:1.1},flow:{baseFrequencyX:.01,baseFrequencyY:.016,numOctaves:2,scale:18,seed:7,ampX:.006,ampY:0,rateX:.7,rateY:0},wobble:{baseFrequencyX:.006,baseFrequencyY:.006,numOctaves:1,scale:28,seed:11,ampX:.0022,ampY:.0022,rateX:.55,rateY:.5}},lr=t=>Math.round(t*1e4)/1e4;function ur(t,e={}){let n=Qe[t]??Qe.ripple,r=e.scale!=null&&Number.isFinite(e.scale)?e.scale:n.scale;return e.maxScale!=null&&Number.isFinite(e.maxScale)&&(r=Math.min(r,e.maxScale)),r=Math.max(0,r),{baseFrequencyX:n.baseFrequencyX,baseFrequencyY:n.baseFrequencyY,numOctaves:n.numOctaves,scale:r,seed:n.seed}}function dr(t,e,n=1){let r=Qe[t]??Qe.ripple,s=(Number.isFinite(e)?e:0)*(Number.isFinite(n)?n:1),i=r.baseFrequencyX+r.ampX*Math.sin(s*r.rateX),a=r.ampY?r.baseFrequencyY+r.ampY*Math.cos(s*r.rateY):r.baseFrequencyY;return[lr(Math.max(1e-4,i)),lr(Math.max(1e-4,a))]}var fr="liquid-glass",mn=0;function pn(){if(typeof navigator>"u")return!1;let t=navigator.userAgent||"";return/(iphone|ipad|ipod)/i.test(t)||/firefox|fxios/i.test(t)?!1:/(chrome|chromium|edg|opr)\//i.test(t)}function H(t,e,n){let r=parseFloat(t.getAttribute(e)||"");return Number.isFinite(r)?r:n}var gn="linear-gradient(135deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.06) 16%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.12) 100%)",bn=typeof HTMLElement>"u"?class{}:HTMLElement,Je=class extends bn{static get observedAttributes(){return["renderer","effect-mode","backdrop-selector","backdrop-version","lens-profile","strength","dispersion","radius","frost","blur","saturation","displace","scale","border-color","lightness","alpha","angle","shape-adapt","lens","lens-strength","lens-center","liquid","liquid-speed","liquid-scale"]}filterId=`lg-wc-${++mn}`;root;ro;resizeFrame=0;liquidRaf=0;webgl;refreshBackdrop(){return this.webgl?.refresh()??Promise.resolve()}constructor(){super(),this.root=this.attachShadow({mode:"open"})}connectedCallback(){this.render(),typeof ResizeObserver<"u"&&(this.ro=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame),this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=0,this.isConnected&&this.render()})}),this.ro.observe(this))}disconnectedCallback(){this.webgl?.destroy(),this.webgl=void 0,this.ro?.disconnect(),cancelAnimationFrame(this.resizeFrame),this.liquidRaf&&cancelAnimationFrame(this.liquidRaf)}attributeChangedCallback(){this.isConnected&&this.render()}render(){this.webgl?.destroy(),this.webgl=void 0;let e=H(this,"radius",50),n=H(this,"frost",.1),r=H(this,"blur",0),s=H(this,"saturation",140),i=H(this,"displace",5),a=H(this,"scale",160),o=H(this,"lightness",53),l=H(this,"alpha",.9),d=.05,c=this.getAttribute("border-color")||"rgba(120, 120, 120, 0.7)",f=dt(H(this,"angle",0)),h=this.getAttribute("shape-adapt")!=="false",p=this.getAttribute("lens"),b=or(p)?p:"classic",g=H(this,"lens-strength",1),_=this.getAttribute("lens-center"),u=(()=>{if(!_)return;let S=_.split(/[ ,]+/).map(parseFloat);return S.length===2&&S.every(Number.isFinite)?[S[0],S[1]]:void 0})(),m=this.getAttribute("liquid"),x=cr(m)?m:null,y=H(this,"liquid-speed",1),E=this.getAttribute("liquid-scale")!=null?H(this,"liquid-scale",NaN):void 0,W=typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches,X=!!x&&!W,$=this.getBoundingClientRect(),R=$.width||300,M=$.height||180,J=this.getAttribute("renderer"),ie=J==="webgl"||J==="svg"?J:"auto",v=this.getAttribute("effect-mode"),T=v==="blur"||v==="off"||v==="svg"?v:"auto",N=Qt(navigator.userAgent,navigator.maxTouchPoints||0),re=Jt(ie,T,N),I=pn()&&!re&&T!=="blur"&&T!=="off",G,Z,U="";if(I){let S=ar({width:R,height:M,divisor:3,quantStep:24,radius:e,border:d,lightness:o,alpha:l,displace:i,blend:"difference",angle:f,shapeAdapt:h,lens:b,lensStrength:g,lensCenter:u,scale:a});G=`saturate(${s}%) url(#${this.filterId})`,Z=`hsl(0 0% 100% / ${n})`;let L="",D="";if(X&&x){let F=ur(x,{speed:y,scale:E});L=' result="lqBase"',D=`<feTurbulence type="fractalNoise" baseFrequency="${F.baseFrequencyX} ${F.baseFrequencyY}" numOctaves="${F.numOctaves}" seed="${F.seed}" result="lqNoise" data-lg-turb="1"/><feDisplacementMap in="lqBase" in2="lqNoise" scale="${F.scale}" xChannelSelector="R" yChannelSelector="G"/>`}U=`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${this.filterId}" color-interpolation-filters="sRGB"><feImage href="${S}" x="0" y="0" width="100%" height="100%" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${a}" xChannelSelector="R" yChannelSelector="B" result="out"/><feGaussianBlur in="out" stdDeviation="${r}"${L}/>${D}</filter></svg>`}else G=`blur(${Math.max(r,9)}px) saturate(${Math.max(s,160)}%) brightness(1.04)`,Z=`${gn}, hsl(0 0% 100% / ${n})`;if(T==="off"&&(G="none",Z="transparent"),delete this.dataset.glassReason,this.dataset.glassStrategy=T==="off"?"off":I?"svg":"blur",this.root.innerHTML=`
      <style>
        :host { display: block; position: relative; }
        .lg-glass { position: absolute; inset: 0; z-index: 0; border-radius: ${e}px; overflow: hidden;
          background: ${Z}; backdrop-filter: ${G}; -webkit-backdrop-filter: ${G}; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.12); }
        .lg-border { position: absolute; inset: 0; z-index: 2; border-radius: ${e}px; pointer-events: none;

          -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0); mask-composite: exclude; border: 1px solid transparent; }
        .lg-content { position: relative; z-index: 3; width: 100%; height: 100%; }
      </style>
      <div class="lg-glass" part="glass"></div>
      <div class="lg-border" part="border"></div>
      <div class="lg-content"><slot></slot></div>
      ${U}
    `,re){let S=null;try{let L=this.getAttribute("backdrop-selector");L&&(S=document.querySelector(L))}catch{this.dataset.glassReason="invalid-selector"}if(!S||S.contains(this)||this.contains(S))this.dataset.glassReason||=S?"invalid-backdrop":"missing-backdrop";else{let L=document.createElement("div");L.style.cssText=`position:absolute;inset:0;border-radius:${e}px;overflow:hidden;pointer-events:none;visibility:hidden`,L.setAttribute("aria-hidden","true"),this.root.prepend(L);let D=this.getAttribute("lens-profile"),F=D==="material"||D==="loupe"||D==="track"?D:"player",oe=ct(F,this.hasAttribute("strength")?{strength:H(this,"strength",.16)}:void 0),P=this.offsetWidth||R,j=this.offsetHeight||M;try{this.webgl=Kt(this,L,S,{map:sr(P,j,e,F,oe),scale:a/160*oe.strength*(F==="player"?500:Math.hypot(P,j)/Math.SQRT2),dispersion:Math.min(1,Math.abs(H(this,"dispersion",50))/50),specular:oe.specular,classic:!1,radius:e,blur:r,saturation:s},K=>{let w=K==="active";this.dataset.glassStrategy=w?"webgl":K==="pending"?"pending":"blur",this.dataset.glassReason=w?N?"ios-webgl":"webgl-requested":K,L.style.visibility=w?"visible":"hidden";let te=this.root.querySelector(".lg-glass");te.style.backdropFilter=w?"none":G,te.style.setProperty("-webkit-backdrop-filter",w?"none":G),te.style.background=w?`hsl(0 0% 100% / ${n})`:Z})}catch{this.dataset.glassReason="webgl-unavailable"}}}let ee=this.root.querySelector(".lg-border");if(ee&&(ee.style.background=`linear-gradient(315deg, ${c} 0%, rgba(120,120,120,0) 30%, rgba(120,120,120,0) 70%, ${c} 100%) border-box`),this.liquidRaf&&(cancelAnimationFrame(this.liquidRaf),this.liquidRaf=0),X&&x){let S=this.root.querySelector("[data-lg-turb]");if(S){let L=0,D=F=>{L||(L=F);let[oe,P]=dr(x,(F-L)/1e3,y);S.setAttribute("baseFrequency",`${oe} ${P}`),this.liquidRaf=requestAnimationFrame(D)};this.liquidRaf=requestAnimationFrame(D)}}}};function xn(t=fr){typeof window>"u"||!window.customElements||customElements.get(t)||customElements.define(t,t===fr?Je:class extends Je{})}xn();})();
/*! Copyright (c) 2026 Sam Asante. MIT; see THIRD_PARTY_NOTICES.md. */

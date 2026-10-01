(()=>{var Ge=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
	v_uv = a_pos * 0.5 + 0.5;
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`,yt=`
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec2 v_uv;
void main() {
	gl_FragColor = texture2D(u_tex, v_uv * u_scale + u_offset);
}`,wt=`
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
}`,Et=`
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
}`;var Rt={blurAmount:0,refraction:.69,chromAberration:.05,edgeHighlight:.05,specular:0,fresnel:1,distortion:0,cornerRadius:65,zRadius:40,opacity:1,saturation:0,tintStrength:0,brightness:0,shadowOpacity:.3,shadowSpread:10,shadowOffsetY:1,floating:!1,button:!1,bevelMode:0},Ne=6,V=20;var ze=class{constructor(){this.fboCache=new Map;this.activeFBOs=null;this.bgTex=null;this.width=0;this.height=0;this.contextLost=!1;this.canvas=document.createElement("canvas"),this.canvas.style.display="none",this.cropCanvas=document.createElement("canvas"),this.cropCtx=this.cropCanvas.getContext("2d");let e=this.canvas.getContext("webgl",{alpha:!0,premultipliedAlpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!e)throw new Error("LiquidGlass: WebGL is not supported in this browser.");this.gl=e,this._initPrograms(),this._initBuffers(),this._onContextLost=n=>{n.preventDefault(),this.contextLost=!0,console.warn("LiquidGlass: WebGL context lost.")},this._onContextRestored=()=>{console.info("LiquidGlass: WebGL context restored \u2014 reinitialising."),this.contextLost=!1,this._initPrograms(),this._initBuffers();for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.activeFBOs=null,this.bgTex=null},this.canvas.addEventListener("webglcontextlost",this._onContextLost),this.canvas.addEventListener("webglcontextrestored",this._onContextRestored)}_initPrograms(){this.blitP=this._link(Ge,yt),this.blitU=this._uloc(this.blitP,["u_tex","u_scale","u_offset"]),this.blurP=this._link(Ge,wt),this.blurU=this._uloc(this.blurP,["u_tex","u_dir"]),this.glassP=this._link(Xe,Et),this.glassU=this._uloc(this.glassP,["u_bgTex","u_blurTex","u_center","u_size","u_radius","u_res","u_pad","u_refract","u_chroma","u_edgeHL","u_spec","u_fresnel","u_distort","u_alpha","u_sat","u_tint","u_zRadius","u_brightness","u_shadowAlpha","u_shadowSpread","u_shadowOffY","u_bevelMode"])}_initBuffers(){let e=this.gl;this.quadBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),this.panelBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.panelBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]),e.STATIC_DRAW)}resize(e,n){this.width=e,this.height=n;for(let r of this.fboCache.values())this._freeFBOSet(r);this.fboCache.clear(),this.activeFBOs=null,this.canvas.width=0,this.canvas.height=0}uploadAndBlur(e,n,r,s,i,o){if(this.contextLost)return;let a=this.gl;if(!this._setActiveSize(s,i))return;let l=this.width,d=this.height,u=this.activeFBOs,f=e;(n!==0||r!==0||e.width!==l||e.height!==d)&&((this.cropCanvas.width!==l||this.cropCanvas.height!==d)&&(this.cropCanvas.width=l,this.cropCanvas.height=d),this.cropCtx.clearRect(0,0,l,d),this.cropCtx.drawImage(e,-n,-r),f=this.cropCanvas),this.bgTex||(this.bgTex=a.createTexture()),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.bgTex),a.pixelStorei(a.UNPACK_FLIP_Y_WEBGL,!0),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,a.RGBA,a.UNSIGNED_BYTE,f),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MIN_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MAG_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_S,a.CLAMP_TO_EDGE),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_T,a.CLAMP_TO_EDGE),a.pixelStorei(a.UNPACK_FLIP_Y_WEBGL,!1),a.bindFramebuffer(a.FRAMEBUFFER,u.bg.fbo),a.viewport(0,0,l,d),a.useProgram(this.blitP),a.activeTexture(a.TEXTURE0),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.bgTex),a.uniform1i(this.blitU.u_tex,0),a.uniform2f(this.blitU.u_scale,1,1),a.uniform2f(this.blitU.u_offset,0,0),this._drawQuad(this.blitP,this.quadBuf);let m=u.blurA.w,p=u.blurA.h;if(a.bindFramebuffer(a.FRAMEBUFFER,u.blurA.fbo),a.viewport(0,0,m,p),a.bindTexture(a.TEXTURE_2D,u.bg.tex),this._drawQuad(this.blitP,this.quadBuf),o>0){let v=o*2.5;a.useProgram(this.blurP),a.uniform1i(this.blurU.u_tex,0);for(let g=0;g<Ne;g++)a.bindFramebuffer(a.FRAMEBUFFER,u.blurB.fbo),a.viewport(0,0,m,p),a.bindTexture(a.TEXTURE_2D,u.blurA.tex),a.uniform2f(this.blurU.u_dir,v/m,0),this._drawQuad(this.blurP,this.quadBuf),a.bindFramebuffer(a.FRAMEBUFFER,u.blurA.fbo),a.bindTexture(a.TEXTURE_2D,u.blurB.tex),a.uniform2f(this.blurU.u_dir,0,v/p),this._drawQuad(this.blurP,this.quadBuf)}}renderGlassPanel(e,n,r,s){if(this.contextLost)return;let i=this.gl,o=this.width,a=this.height,l=this.activeFBOs;i.enable(i.BLEND),i.blendFunc(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA),i.useProgram(this.glassP),i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,l.bg.tex),i.uniform1i(this.glassU.u_bgTex,0),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,l.blurA.tex),i.uniform1i(this.glassU.u_blurTex,1),i.bindFramebuffer(i.FRAMEBUFFER,null),i.viewport(0,this.canvas.height-a,o,a),i.uniform2f(this.glassU.u_res,o,a),i.uniform2f(this.glassU.u_center,o*.5,a*.5),i.uniform2f(this.glassU.u_size,n*s,r*s),i.uniform1f(this.glassU.u_radius,e.cornerRadius*s),i.uniform1f(this.glassU.u_pad,V*s),i.uniform1f(this.glassU.u_refract,e.refraction),i.uniform1f(this.glassU.u_chroma,e.chromAberration),i.uniform1f(this.glassU.u_edgeHL,e.edgeHighlight),i.uniform1f(this.glassU.u_spec,e.specular),i.uniform1f(this.glassU.u_fresnel,e.fresnel),i.uniform1f(this.glassU.u_distort,e.distortion),i.uniform1f(this.glassU.u_alpha,e.opacity),i.uniform1f(this.glassU.u_sat,e.saturation),i.uniform1f(this.glassU.u_tint,e.tintStrength),i.uniform1f(this.glassU.u_zRadius,e.zRadius*s),i.uniform1f(this.glassU.u_brightness,e.brightness),i.uniform1f(this.glassU.u_shadowAlpha,e.shadowOpacity),i.uniform1f(this.glassU.u_shadowSpread,e.shadowSpread*s),i.uniform1f(this.glassU.u_shadowOffY,e.shadowOffsetY*s),i.uniform1f(this.glassU.u_bevelMode,e.bevelMode),this._drawQuad(this.glassP,this.panelBuf),i.disable(i.BLEND)}clear(){let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,this.canvas.height-this.height,this.width,this.height),e.enable(e.SCISSOR_TEST),e.scissor(0,this.canvas.height-this.height,this.width,this.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.disable(e.SCISSOR_TEST)}destroy(){if(this.canvas.removeEventListener("webglcontextlost",this._onContextLost),this.canvas.removeEventListener("webglcontextrestored",this._onContextRestored),!this.contextLost){let e=this.gl;for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.bgTex&&e.deleteTexture(this.bgTex),e.deleteBuffer(this.quadBuf),e.deleteBuffer(this.panelBuf),e.deleteProgram(this.blitP),e.deleteProgram(this.blurP),e.deleteProgram(this.glassP)}this.canvas.remove()}_setActiveSize(e,n){if(e<=0||n<=0)return!1;this.width=e,this.height=n,(this.canvas.width!==e||this.canvas.height!==n)&&(this.canvas.width=e,this.canvas.height=n);let r=`${e}x${n}`,s=this.fboCache.get(r);if(!s){for(let i of this.fboCache.values())this._freeFBOSet(i);this.fboCache.clear(),s={bg:this._makeFBO(e,n),blurA:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2)),blurB:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2))},this.fboCache.set(r,s)}return this.activeFBOs=s,!0}_makeFBO(e,n){let r=this.gl,s=r.createTexture();r.bindTexture(r.TEXTURE_2D,s),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,e,n,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);let i=r.createFramebuffer();return r.bindFramebuffer(r.FRAMEBUFFER,i),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,s,0),r.bindFramebuffer(r.FRAMEBUFFER,null),{fbo:i,tex:s,w:e,h:n}}_freeFBO(e){if(!e)return;let n=this.gl;n.deleteFramebuffer(e.fbo),n.deleteTexture(e.tex)}_freeFBOSet(e){this._freeFBO(e.bg),this._freeFBO(e.blurA),this._freeFBO(e.blurB)}_compile(e,n){let r=this.gl,s=r.createShader(n);return r.shaderSource(s,e),r.compileShader(s),r.getShaderParameter(s,r.COMPILE_STATUS)?s:(console.error("LiquidGlass shader compile error:",r.getShaderInfoLog(s),e),null)}_link(e,n){let r=this.gl,s=r.createProgram();return r.attachShader(s,this._compile(e,r.VERTEX_SHADER)),r.attachShader(s,this._compile(n,r.FRAGMENT_SHADER)),r.linkProgram(s),r.getProgramParameter(s,r.LINK_STATUS)||console.error("LiquidGlass program link error:",r.getProgramInfoLog(s)),s}_uloc(e,n){let r=this.gl,s={};for(let i of n)s[i]=r.getUniformLocation(e,i);return s}_drawQuad(e,n){let r=this.gl,s=r.getAttribLocation(e,"a_pos");r.bindBuffer(r.ARRAY_BUFFER,n),r.enableVertexAttribArray(s),r.vertexAttribPointer(s,2,r.FLOAT,!1,0,0),r.drawArrays(r.TRIANGLE_STRIP,0,4)}};function St(t,e,n=()=>e.getBoundingClientRect()){let r=t.renderer,s=r.gl,i,o=null,a=null,l={},d=s.getParameter(s.MAX_TEXTURE_SIZE),u=r.uploadAndBlur.bind(r),f,m=()=>{i=void 0,o=null,a=null};r.canvas.addEventListener("webglcontextrestored",m);let p=()=>{r.canvas.removeEventListener("webglcontextrestored",m),o&&s.deleteTexture(o),a&&s.deleteProgram(a)},v=t.destroy.bind(t);return t.destroy=()=>{p(),v()},r.uploadAndBlur=(g,b,c,h,x,y)=>{if(!f)return u(g,b,c,h,x,y);if(r.contextLost||!r._setActiveSize(h,x))return;let E=r.activeFBOs;if(a||(a=r._link(Ge,`precision highp float;
        uniform sampler2D u_tex; uniform vec2 u_scale; uniform vec2 u_offset; varying vec2 v_uv;
        void main() { vec2 uv = v_uv * u_scale + u_offset;
          gl_FragColor = texture2D(u_tex, clamp(uv, vec2(0.0), vec2(1.0))); }`),l=r._uloc(a,["u_tex","u_scale","u_offset"])),s.bindFramebuffer(s.FRAMEBUFFER,E.bg.fbo),s.viewport(0,0,h,x),s.useProgram(a),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,o),s.uniform1i(l.u_tex,0),s.uniform2f(l.u_scale,f.w,f.h),s.uniform2f(l.u_offset,f.x,f.y),r._drawQuad(a,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,E.blurA.fbo),s.viewport(0,0,E.blurA.w,E.blurA.h),s.useProgram(r.blitP),s.bindTexture(s.TEXTURE_2D,E.bg.tex),s.uniform1i(r.blitU.u_tex,0),s.uniform2f(r.blitU.u_scale,1,1),s.uniform2f(r.blitU.u_offset,0,0),r._drawQuad(r.blitP,r.quadBuf),y>0){let W=y*2.5;s.useProgram(r.blurP),s.uniform1i(r.blurU.u_tex,0);for(let X=0;X<Ne;X++)s.bindFramebuffer(s.FRAMEBUFFER,E.blurB.fbo),s.bindTexture(s.TEXTURE_2D,E.blurA.tex),s.uniform2f(r.blurU.u_dir,W/E.blurA.w,0),r._drawQuad(r.blurP,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,E.blurA.fbo),s.bindTexture(s.TEXTURE_2D,E.blurB.tex),s.uniform2f(r.blurU.u_dir,0,W/E.blurA.h),r._drawQuad(r.blurP,r.quadBuf)}},(g,b)=>{if(f=void 0,!g)return!1;let c=t.capture.cache.get(e)?.canvas;if(!c||c.width>d||c.height>d||c.width*c.height*4>64*1024*1024||r.contextLost)return!1;c!==i&&(o||=s.createTexture(),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,o),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,1),s.texImage2D(s.TEXTURE_2D,0,s.RGBA,s.RGBA,s.UNSIGNED_BYTE,c),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,0),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAG_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE),i=c);let h=n();return f={x:(g.left-b-h.left)/h.width,y:1-(g.bottom+b-h.top)/h.height,w:(g.width+b*2)/h.width,h:(g.height+b*2)/h.height},!0}}var At=.22,mr=Math.sqrt(Math.PI),pr=t=>Math.tanh(mr*t),Tt=(t,e)=>e>0?(t-Math.sqrt(t*t-e*e))/e:0,gr=(t,e,n)=>{let r=Math.max(.01,Math.min(t,Math.min(e,n)-1)),s=(e*e+r*r)/(2*r),i=(n*n+r*r)/(2*r),o=Tt(s,e),a=Tt(i,n);return{Rx:s,Ry:i,scaleX:o>0?.5/o:1,scaleY:a>0?.5/a:1}},br=(t,e,n)=>{let r=Math.min(t,e*.999);return r/Math.sqrt(e*e-r*r)*n};var Ve=t=>(.5+t)*255+.5|0,Mt=t=>127*t+128+.5|0,Lt=t=>{let e=null,n=null,r=null,s=null,i=-1/0,o=-1/0,a=-1/0,l=0,d=!0,u=null;return{generate(f){e||(e=document.createElement("canvas"),e.width=t,e.height=t,n=e.getContext("2d"),r=n.createImageData(t,t));let{lensHalfWidth:m,lensHalfHeight:p,borderRadius:v,depth:g,clipToShape:b,softEdge:c,sheenAngle:h=45,glow:x=0,glowSpread:y=1,glowFalloff:E=1.5,sheen:W=0,sheenWidth:X=3,sheenFalloff:$=1.5,curvature:R=0,splay:M=0,bend:J=0,bendWidth:ie=.16}=f,_=r.data,T=t>>1,N=Math.min(v,Math.min(m,p)),re=Math.min(m,p),I=Math.min(g*re,re-1),G=Math.max(0,m-I),Z=Math.max(0,p-I),U=Math.max(0,Math.min(v,Math.min(G,Z))),ee=I>0?Math.SQRT1_2/I:1e6,S=x>0||W>0,L=h*Math.PI/180,D=Math.cos(L),F=Math.sin(L),ae=X>0?1/X:0,P=1/Math.max(2,y*Math.min(m,p)),j=2*m/t,K=2*p/t,w=1/m,te=1/p,Se=R>0,oe=R*Math.min(m,p),ge=M>0,be=J>0,Te=1/Math.max(2,ie*Math.min(m,p)),xe=(C,B)=>C>0||B>0?Math.sqrt(C*C+B*B):0;if(Se&&((!u||Math.abs(oe-i)>.5||Math.abs(m-o)>1||Math.abs(p-a)>1)&&(u=gr(oe,m,p),i=oe,o=m,a=p,d=!0),l!==T&&(s=new Float32Array(T),l=T,d=!0),d)){let C=s,B=u,q=B.Rx*B.Rx,z=B.Rx*(1-.001);for(let k=0;k<T;k+=1){let he=-((k+.5)*j-m),ne=he<z?he:z;C[k]=ne/Math.sqrt(q-ne*ne)*B.scaleX}d=!1}let Fe=Se?s:null,$e=.5*Math.min(m,p),ve=$e>0?1/$e:0,_e=Math.SQRT1_2;for(let C=0;C<T;C+=1){let B=t-1-C,q=-((C+.5)*K-p),z=q-p+N,k=c?q-Z+U:0,he=Se&&Fe?br(q,u.Ry,u.scaleY):q*te>1?1:q*te,ne=q*te>1?1:q*te,He=ge?Math.max(0,1-(p-q)*ve):0,Pe=C*t,le=B*t;for(let ce=0;ce<T;ce+=1){let ht=t-1-ce,ye=-((ce+.5)*j-m),Ce=ye-m+N,we=xe(Ce>0?Ce:0,z>0?z:0)+(Ce>z?Ce>0?0:Ce:z>0?0:z)-N,Ue=(Pe+ce)*4,De=(Pe+ht)*4,Be=(le+ce)*4,ke=(le+ht)*4;if(b&&we>=0){for(let A of[Ue,De,Be,ke])_[A]=128,_[A+1]=128,_[A+2]=128,_[A+3]=255;continue}let ue=Fe?Fe[ce]:ye*w>1?1:ye*w,de=he;if(ge){let A=He*M,se=Math.max(0,1-(m-ye)*ve)*M;if(A>.001||se>.001){let me=ue,fe=de;ue=me*(1-A),de=fe*(1-se);let pe=Math.sqrt(me*me+fe*fe),Ie=Math.sqrt(ue*ue+de*de);if(Ie>.001){let _t=pe/Ie;ue*=_t,de*=_t}}}let Oe=1;if(c){let A=ye-G+U,se=xe(A>0?A:0,k>0?k:0)+(A>k?A>0?0:A:k>0?0:k)-U;Oe=.5*(1+pr(se*ee))}let Ze=.5*ue*Oe,et=.5*de*Oe;if(be){let A=we<0?Math.max(0,1+we*Te):0;if(A>0){let se=Math.sqrt(ue*ue+de*de);if(se>1e-4){let me=6.75*A*A*(1-A),fe=.5*J*me*Oe/se;Ze+=ue*fe,et+=de*fe}}}let Ee=0,Re=0;if(S){let A=ye*w>1?1:ye*w,se=Math.min(1,Math.abs(A*D+ne*F)*_e),me=Math.min(1,Math.abs(A*D-ne*F)*_e);if(W>0){let fe=we<0?Math.max(0,1+we*ae):0,pe=W*Math.pow(fe,$);Ee+=pe*(.16+.84*Math.pow(se,1.6)),Re+=pe*(.16+.84*Math.pow(me,1.6))}if(x>0){let pe=1-(we<0?Math.min(1,-we*P):1),Ie=x*Math.pow(pe*pe*(3-2*pe),E)*Oe;Ee+=Ie*(.6+.4*se),Re+=Ie*(.6+.4*me)}Ee>1?Ee=1:Ee<-1&&(Ee=-1),Re>1?Re=1:Re<-1&&(Re=-1)}let mt=Ve(Ze),pt=Ve(-Ze),gt=Ve(et),bt=Ve(-et),xt=Mt(Ee),vt=Mt(Re);_[Ue]=mt,_[Ue+1]=gt,_[Ue+2]=xt,_[Ue+3]=255,_[De]=pt,_[De+1]=gt,_[De+2]=vt,_[De+3]=255,_[Be]=mt,_[Be+1]=bt,_[Be+2]=vt,_[Be+3]=255,_[ke]=pt,_[ke+1]=bt,_[ke+2]=xt,_[ke+3]=255}}return n.putImageData(r,0,0),e.toDataURL()},dispose(){e&&(e.width=0,e.height=0,e=null),n=null,r=null,s=null,u=null,i=-1/0,o=-1/0,a=-1/0,l=0,d=!0}}};var xr=`precision highp float;
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
}`;function Ft(t,e){let n=t.renderer,r=n.gl,s=n.renderGlassPanel.bind(n),i=null,o=null,a="",l=0,d={},u={ready:!1,failed:!1,mapUploads:0,mapUrl:"",scale:0},f=()=>{i=null,o=null,a="",l++,u.ready=!1};n.canvas.addEventListener("webglcontextrestored",f);let m=t.destroy.bind(t);return t.destroy=()=>{l++,n.canvas.removeEventListener("webglcontextrestored",f),o&&r.deleteTexture(o),m()},n.renderGlassPanel=(p,v,g,b)=>{let c=e(),h=c.map;if(h!==a){a=h,u.failed=!1;let x=++l,y=new Image;y.onload=()=>{x!==l||n.contextLost||(o||=r.createTexture(),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,o),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,0),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,r.NONE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,r.RGBA,r.UNSIGNED_BYTE,y),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),u.ready=!0,u.mapUploads++,u.mapUrl=h,t.markChanged())},y.onerror=()=>{x===l&&(u.failed=!0,t.markChanged())},y.src=h}o&&(i||(i=n._link(Xe,xr),r.deleteProgram(n.glassP),n.glassP=i,n.glassU=n._uloc(i,Object.keys(n.glassU)),d=n._uloc(i,["u_lensMap","u_mapScale","u_mapDispersion","u_mapSpecular","u_classic","u_saturation","u_additive","u_neutral"])),u.scale=c.scale,r.useProgram(i),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,o),r.uniform1i(d.u_lensMap,2),r.uniform1f(d.u_mapScale,u.scale*b),r.uniform1f(d.u_mapDispersion,(c.additiveDispersion??c.classic?b:At)*c.dispersion),r.uniform1f(d.u_mapSpecular,c.specular),r.uniform1f(d.u_classic,c.classic?1:0),r.uniform1f(d.u_saturation,c.saturation/100),r.uniform1f(d.u_additive,c.additiveDispersion??c.classic?1:0),r.uniform1f(d.u_neutral,c.neutralPoint??.5),s(p,v,g,b))},u}function $t(t,e){if(t.match(/^[a-z]+:\/\//i))return t;if(t.match(/^\/\//))return window.location.protocol+t;if(t.match(/^[a-z]+:/i))return t;let n=document.implementation.createHTMLDocument(),r=n.createElement("base"),s=n.createElement("a");return n.head.appendChild(r),n.body.appendChild(s),e&&(r.href=e),s.href=t,s.href}var Pt=(()=>{let t=0,e=()=>`0000${(Math.random()*36**4<<0).toString(36)}`.slice(-4);return()=>(t+=1,`u${e()}${t}`)})();function Q(t){let e=[];for(let n=0,r=t.length;n<r;n++)e.push(t[n]);return e}function Ye(t,e){let r=(t.ownerDocument.defaultView||window).getComputedStyle(t).getPropertyValue(e);return r?parseFloat(r.replace("px","")):0}function vr(t){let e=Ye(t,"border-left-width"),n=Ye(t,"border-right-width");return t.clientWidth+e+n}function _r(t){let e=Ye(t,"border-top-width"),n=Ye(t,"border-bottom-width");return t.clientHeight+e+n}function tt(t,e={}){let n=e.width||vr(t),r=e.height||_r(t);return{width:n,height:r}}function Ct(){let t,e;try{e=process}catch{}let n=e&&e.env?e.env.devicePixelRatio:null;return n&&(t=parseInt(n,10),Number.isNaN(t)&&(t=1)),t||window.devicePixelRatio||1}var Y=16384;function Ut(t){(t.width>Y||t.height>Y)&&(t.width>Y&&t.height>Y?t.width>t.height?(t.height*=Y/t.width,t.width=Y):(t.width*=Y/t.height,t.height=Y):t.width>Y?(t.height*=Y/t.width,t.width=Y):(t.width*=Y/t.height,t.height=Y))}function Me(t){return new Promise((e,n)=>{let r=new Image;r.decode=()=>e(r),r.onload=()=>e(r),r.onerror=n,r.crossOrigin="anonymous",r.decoding="async",r.src=t})}async function yr(t){return Promise.resolve().then(()=>new XMLSerializer().serializeToString(t)).then(encodeURIComponent).then(e=>`data:image/svg+xml;charset=utf-8,${e}`)}async function Dt(t,e,n){let r="http://www.w3.org/2000/svg",s=document.createElementNS(r,"svg"),i=document.createElementNS(r,"foreignObject");return s.setAttribute("width",`${e}`),s.setAttribute("height",`${n}`),s.setAttribute("viewBox",`0 0 ${e} ${n}`),i.setAttribute("width","100%"),i.setAttribute("height","100%"),i.setAttribute("x","0"),i.setAttribute("y","0"),i.setAttribute("externalResourcesRequired","true"),s.appendChild(i),i.appendChild(t),yr(s)}var O=(t,e)=>{if(t instanceof e)return!0;let n=Object.getPrototypeOf(t);return n===null?!1:n.constructor.name===e.name||O(n,e)};function wr(t){let e=t.getPropertyValue("content");return`${t.cssText} content: '${e.replace(/'|"/g,"")}';`}function Er(t){return Q(t).map(e=>{let n=t.getPropertyValue(e),r=t.getPropertyPriority(e);return`${e}: ${n}${r?" !important":""};`}).join(" ")}function Rr(t,e,n){let r=`.${t}:${e}`,s=n.cssText?wr(n):Er(n);return document.createTextNode(`${r}{${s}}`)}function Bt(t,e,n){let r=window.getComputedStyle(t,n),s=r.getPropertyValue("content");if(s===""||s==="none")return;let i=Pt();try{e.className=`${e.className} ${i}`}catch{return}let o=document.createElement("style");o.appendChild(Rr(i,n,r)),e.appendChild(o)}function kt(t,e){Bt(t,e,":before"),Bt(t,e,":after")}var Ot="application/font-woff",It="image/jpeg",Sr={woff:Ot,woff2:Ot,ttf:"application/font-truetype",eot:"application/vnd.ms-fontobject",png:"image/png",jpg:It,jpeg:It,gif:"image/gif",tiff:"image/tiff",svg:"image/svg+xml",webp:"image/webp"};function Tr(t){let e=/\.([^./]*?)$/g.exec(t);return e?e[1]:""}function Ae(t){let e=Tr(t).toLowerCase();return Sr[e]||""}function Mr(t){return t.split(/,/)[1]}function qe(t){return t.search(/^(data:)/)!==-1}function nt(t,e){return`data:${e};base64,${t}`}async function st(t,e,n){let r=await fetch(t,e);if(r.status===404)throw new Error(`Resource "${r.url}" not found`);let s=await r.blob();return new Promise((i,o)=>{let a=new FileReader;a.onerror=o,a.onloadend=()=>{try{i(n({res:r,result:a.result}))}catch(l){o(l)}},a.readAsDataURL(s)})}var rt={};function Ar(t,e,n){let r=t.replace(/\?.*/,"");return n&&(r=t),/ttf|otf|eot|woff2?/i.test(r)&&(r=r.replace(/.*\//,"")),e?`[${e}]${r}`:r}async function Le(t,e,n){let r=Ar(t,e,n.includeQueryParams);if(rt[r]!=null)return rt[r];n.cacheBust&&(t+=(/\?/.test(t)?"&":"?")+new Date().getTime());let s;try{let i=await st(t,n.fetchRequestInit,({res:o,result:a})=>(e||(e=o.headers.get("Content-Type")||""),Mr(a)));s=nt(i,e)}catch(i){s=n.imagePlaceholder||"";let o=`Failed to fetch resource: ${t}`;i&&(o=typeof i=="string"?i:i.message),o&&console.warn(o)}return rt[r]=s,s}async function Lr(t){let e=t.toDataURL();return e==="data:,"?t.cloneNode(!1):Me(e)}async function Fr(t,e){if(t.currentSrc){let i=document.createElement("canvas"),o=i.getContext("2d");i.width=t.clientWidth,i.height=t.clientHeight,o?.drawImage(t,0,0,i.width,i.height);let a=i.toDataURL();return Me(a)}let n=t.poster,r=Ae(n),s=await Le(n,r,e);return Me(s)}async function $r(t){var e;try{if(!((e=t?.contentDocument)===null||e===void 0)&&e.body)return await We(t.contentDocument.body,{},!0)}catch{}return t.cloneNode(!1)}async function Pr(t,e){return O(t,HTMLCanvasElement)?Lr(t):O(t,HTMLVideoElement)?Fr(t,e):O(t,HTMLIFrameElement)?$r(t):t.cloneNode(!1)}var Cr=t=>t.tagName!=null&&t.tagName.toUpperCase()==="SLOT";async function Ur(t,e,n){var r,s;let i=[];return Cr(t)&&t.assignedNodes?i=Q(t.assignedNodes()):O(t,HTMLIFrameElement)&&(!((r=t.contentDocument)===null||r===void 0)&&r.body)?i=Q(t.contentDocument.body.childNodes):i=Q(((s=t.shadowRoot)!==null&&s!==void 0?s:t).childNodes),i.length===0||O(t,HTMLVideoElement)||await i.reduce((o,a)=>o.then(()=>We(a,n)).then(l=>{l&&e.appendChild(l)}),Promise.resolve()),e}function Dr(t,e){let n=e.style;if(!n)return;let r=window.getComputedStyle(t);r.cssText?(n.cssText=r.cssText,n.transformOrigin=r.transformOrigin):["box-sizing","display","position","top","right","bottom","left","z-index","width","height","min-width","min-height","max-width","max-height","margin-top","margin-right","margin-bottom","margin-left","padding-top","padding-right","padding-bottom","padding-left","border-top-width","border-right-width","border-bottom-width","border-left-width","border-top-style","border-right-style","border-bottom-style","border-left-style","border-top-color","border-right-color","border-bottom-color","border-left-color","border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","border-collapse","border-spacing","background-color","background-image","background-position","background-size","background-repeat","background-origin","background-clip","background-blend-mode","box-shadow","opacity","color","fill","fill-opacity","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","stroke-opacity","font-family","font-size","font-weight","font-style","font-variant","font-stretch","font-feature-settings","line-height","letter-spacing","word-spacing","text-align","text-indent","text-transform","text-decoration","text-shadow","text-overflow","white-space","word-break","overflow-wrap","line-break","direction","writing-mode","text-orientation","flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis","order","justify-content","justify-items","justify-self","align-content","align-items","align-self","grid-template-columns","grid-template-rows","grid-auto-columns","grid-auto-rows","grid-auto-flow","grid-column-start","grid-column-end","grid-row-start","grid-row-end","row-gap","column-gap","transform","transform-origin","translate","rotate","scale","perspective","overflow-x","overflow-y","clip-path","object-fit","object-position","vertical-align","float","clear","isolation","filter","visibility","list-style-type","list-style-position","list-style-image","table-layout"].forEach(s=>{let i=r.getPropertyValue(s);O(t,HTMLIFrameElement)&&s==="display"&&i==="inline"&&(i="block"),s==="d"&&e.getAttribute("d")&&(i=`path(${e.getAttribute("d")})`),n.setProperty(s,i,r.getPropertyPriority(s))})}function Br(t,e){O(t,HTMLTextAreaElement)&&(e.innerHTML=t.value),O(t,HTMLInputElement)&&e.setAttribute("value",t.value)}function kr(t,e){if(O(t,HTMLSelectElement)){let r=Array.from(e.children).find(s=>t.value===s.getAttribute("value"));r&&r.setAttribute("selected","")}}function Or(t,e){return O(e,Element)&&(Dr(t,e),kt(t,e),Br(t,e),kr(t,e)),e}async function Ir(t,e){let n=t.querySelectorAll?t.querySelectorAll("use"):[];if(n.length===0)return t;let r={};for(let i=0;i<n.length;i++){let a=n[i].getAttribute("xlink:href");if(a){let l=t.querySelector(a),d=document.querySelector(a);!l&&d&&!r[a]&&(r[a]=await We(d,e,!0))}}let s=Object.values(r);if(s.length){let i="http://www.w3.org/1999/xhtml",o=document.createElementNS(i,"svg");o.setAttribute("xmlns",i),o.style.position="absolute",o.style.width="0",o.style.height="0",o.style.overflow="hidden",o.style.display="none";let a=document.createElementNS(i,"defs");o.appendChild(a);for(let l=0;l<s.length;l++)a.appendChild(s[l]);t.appendChild(o)}return t}async function We(t,e,n){return!n&&e.filter&&!e.filter(t)?null:Promise.resolve(t).then(r=>Pr(r,e)).then(r=>Ur(t,r,e)).then(r=>Or(t,r)).then(r=>Ir(r,e))}var Gt=/url\((['"]?)([^'"]+?)\1\)/g,Gr=/url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g,qr=/src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;function Wr(t){let e=t.replace(/([.*+?^${}()|\[\]\/\\])/g,"\\$1");return new RegExp(`(url\\(['"]?)(${e})(['"]?\\))`,"g")}function Hr(t){let e=[];return t.replace(Gt,(n,r,s)=>(e.push(s),n)),e.filter(n=>!qe(n))}async function Xr(t,e,n,r,s){try{let i=n?$t(e,n):e,o=Ae(e),a;if(s){let l=await s(i);a=nt(l,o)}else a=await Le(i,o,r);return t.replace(Wr(e),`$1${a}$3`)}catch{}return t}function Nr(t,{preferredFontFormat:e}){return e?t.replace(qr,n=>{for(;;){let[r,,s]=Gr.exec(n)||[];if(!s)return"";if(s===e)return`src: ${r};`}}):t}function it(t){return t.search(Gt)!==-1}async function je(t,e,n){if(!it(t))return t;let r=Nr(t,n);return Hr(r).reduce((i,o)=>i.then(a=>Xr(a,o,e,n)),Promise.resolve(r))}async function Ke(t,e,n){var r;let s=(r=e.style)===null||r===void 0?void 0:r.getPropertyValue(t);if(s){let i=await je(s,null,n);return e.style.setProperty(t,i,e.style.getPropertyPriority(t)),!0}return!1}async function zr(t,e){await Ke("background",t,e)||await Ke("background-image",t,e),await Ke("mask",t,e)||await Ke("mask-image",t,e)}async function Vr(t,e){let n=O(t,HTMLImageElement);if(!(n&&!qe(t.src))&&!(O(t,SVGImageElement)&&!qe(t.href.baseVal)))return;let r=n?t.src:t.href.baseVal,s=await Le(r,Ae(r),e);await new Promise((i,o)=>{t.onload=i,t.onerror=o;let a=t;a.decode&&(a.decode=i),a.loading==="lazy"&&(a.loading="eager"),n?(t.srcset="",t.src=s):t.href.baseVal=s})}async function Yr(t,e){let r=Q(t.childNodes).map(s=>at(s,e));await Promise.all(r).then(()=>t)}async function at(t,e){O(t,Element)&&(await zr(t,e),await Vr(t,e),await Yr(t,e))}function qt(t,e){let{style:n}=t;e.backgroundColor&&(n.backgroundColor=e.backgroundColor),e.width&&(n.width=`${e.width}px`),e.height&&(n.height=`${e.height}px`);let r=e.style;return r!=null&&Object.keys(r).forEach(s=>{n[s]=r[s]}),t}var Wt={};async function Ht(t){let e=Wt[t];if(e!=null)return e;let r=await(await fetch(t)).text();return e={url:t,cssText:r},Wt[t]=e,e}async function Xt(t,e){let n=t.cssText,r=/url\(["']?([^"')]+)["']?\)/g,i=(n.match(/url\([^)]+\)/g)||[]).map(async o=>{let a=o.replace(r,"$1");return a.startsWith("https://")||(a=new URL(a,t.url).href),st(a,e.fetchRequestInit,({result:l})=>(n=n.replace(o,`url(${l})`),[o,l]))});return Promise.all(i).then(()=>n)}function Nt(t){if(t==null)return[];let e=[],n=/(\/\*[\s\S]*?\*\/)/gi,r=t.replace(n,""),s=new RegExp("((@.*?keyframes [\\s\\S]*?){([\\s\\S]*?}\\s*?)})","gi");for(;;){let l=s.exec(r);if(l===null)break;e.push(l[0])}r=r.replace(s,"");let i=/@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi,o="((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})",a=new RegExp(o,"gi");for(;;){let l=i.exec(r);if(l===null){if(l=a.exec(r),l===null)break;i.lastIndex=a.lastIndex}else a.lastIndex=i.lastIndex;e.push(l[0])}return e}async function jr(t,e){let n=[],r=[];return t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach((i,o)=>{if(i.type===CSSRule.IMPORT_RULE){let a=o+1,l=i.href,d=Ht(l).then(u=>Xt(u,e)).then(u=>Nt(u).forEach(f=>{try{s.insertRule(f,f.startsWith("@import")?a+=1:s.cssRules.length)}catch(m){console.error("Error inserting rule from remote css",{rule:f,error:m})}})).catch(u=>{console.error("Error loading remote css",u.toString())});r.push(d)}})}catch(i){let o=t.find(a=>a.href==null)||document.styleSheets[0];s.href!=null&&r.push(Ht(s.href).then(a=>Xt(a,e)).then(a=>Nt(a).forEach(l=>{o.insertRule(l,s.cssRules.length)})).catch(a=>{console.error("Error loading remote stylesheet",a)})),console.error("Error inlining remote css file",i)}}),Promise.all(r).then(()=>(t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach(i=>{n.push(i)})}catch(i){console.error(`Error while reading CSS rules from ${s.href}`,i)}}),n))}function Kr(t){return t.filter(e=>e.type===CSSRule.FONT_FACE_RULE).filter(e=>it(e.style.getPropertyValue("src")))}async function Qr(t,e){if(t.ownerDocument==null)throw new Error("Provided element is not within a Document");let n=Q(t.ownerDocument.styleSheets),r=await jr(n,e);return Kr(r)}async function zt(t,e){let n=await Qr(t,e);return(await Promise.all(n.map(s=>{let i=s.parentStyleSheet?s.parentStyleSheet.href:null;return je(s.cssText,i,e)}))).join(`
`)}async function Vt(t,e){let n=e.fontEmbedCSS!=null?e.fontEmbedCSS:e.skipFonts?null:await zt(t,e);if(n){let r=document.createElement("style"),s=document.createTextNode(n);r.appendChild(s),t.firstChild?t.insertBefore(r,t.firstChild):t.appendChild(r)}}async function Jr(t,e={}){let{width:n,height:r}=tt(t,e),s=await We(t,e,!0);return await Vt(s,e),await at(s,e),qt(s,e),await Dt(s,n,r)}async function Yt(t,e={}){let{width:n,height:r}=tt(t,e),s=await Jr(t,e),i=await Me(s),o=document.createElement("canvas"),a=o.getContext("2d"),l=e.pixelRatio||Ct(),d=e.canvasWidth||n,u=e.canvasHeight||r;return o.width=d*l,o.height=u*l,e.skipAutoScale||Ut(o),o.style.width=`${d}`,o.style.height=`${u}`,e.backgroundColor&&(a.fillStyle=e.backgroundColor,a.fillRect(0,0,o.width,o.height)),a.drawImage(i,0,0,o.width,o.height),o}var ot=new WeakMap,lt="script,style,.app-floating-action,[data-liquid-glass-ignore]",Zr="[data-new-ui],[data-system-glass-preview]",en='[role="dialog"],[role="alertdialog"],[data-glass-create-menu]',tn=new Set(["aria-hidden","data-aria-hidden","data-glass-pressed","data-glass-pointer-focus"]),rn=new Set(["data-state","aria-expanded","aria-controls"]);function nn(t){let e=t.target instanceof Element?t.target:t.target.parentElement;return t.type==="attributes"&&["data-new-ui","data-system-glass-preview"].includes(t.attributeName)?!0:e?.closest(lt)||t.type==="attributes"&&(tn.has(t.attributeName)||e?.matches("[data-glass-menu-trigger]")&&rn.has(t.attributeName))?!1:t.type==="childList"?[...t.addedNodes,...t.removedNodes].some(n=>!(n instanceof Element)||n.matches(Zr)||!n.matches(lt)):!0}var ct=class{constructor(e){this.capture={cache:new Map,suspended:!1};this.listeners=new Set;this.busy=!1;this.disposed=!1;this.dirty=!0;this.revision=0;this.quietUntil=0;this.schedule=()=>{this.disposed||this.capture.suspended||(clearTimeout(this.timer),this.timer=setTimeout(()=>{this.timer=void 0,this.run()},220))};this.syncSuspended=()=>{let e=!!document.querySelector(en);e!==this.capture.suspended&&(this.capture.suspended=e,e?(clearTimeout(this.timer),this.timer=void 0):(this.quietUntil=Math.max(this.quietUntil,performance.now()+240),this.schedule()))};this.mutated=e=>{this.syncSuspended(),e.some(nn)&&this.changed()};this.changed=()=>{this.dirty=!0,this.revision++,this.schedule()};this.interacting=()=>{this.quietUntil=performance.now()+240,this.schedule()};this.refresh=async()=>{this.changed()};this.element=e,this.observer=new MutationObserver(this.mutated),this.observer.observe(e,{subtree:!0,childList:!0,characterData:!0,attributes:!0}),this.portals=new MutationObserver(this.syncSuspended),this.portals.observe(document.body,{childList:!0}),this.resize=new ResizeObserver(this.changed),this.resize.observe(e),e.addEventListener("load",this.changed,!0),e.addEventListener("input",this.changed,!0),document.addEventListener("pointerdown",this.interacting,!0),document.addEventListener("touchstart",this.interacting,{passive:!0,capture:!0}),document.addEventListener("click",this.interacting,!0),window.addEventListener("scroll",this.interacting,{passive:!0}),window.addEventListener("resize",this.changed),window.visualViewport?.addEventListener("resize",this.changed),this.syncSuspended()}async run(){if(this.disposed||document.hidden||this.capture.suspended)return;if(this.busy||performance.now()<this.quietUntil||document.querySelector('.glass-bar[data-pressing="true"],.ios-glass-nav [aria-busy="true"]')){this.schedule();return}let e=this.element.getBoundingClientRect(),n=window.visualViewport,r=n?n.offsetTop+n.height:innerHeight,s=this.capture.cache.get(this.element);if(!this.dirty&&s&&Math.max(r-110,e.top)>=e.top+s.offsetTop&&Math.min(r+20,e.bottom)<=e.top+s.offsetTop+s.cssHeight)return;let i=e.width,o=e.height;if(!i||!o)return;let a=Math.min(384,o),l=Math.max(0,Math.min(o-a,r-230-e.top)),d=e.top+l,u=d+a,f=this.revision,m=!!this.element.querySelector(":scope > [data-system-glass-preview]"),p=new WeakMap,v=g=>{if(g instanceof Element&&g.matches(lt))return!1;let b=g.parentElement;if(!b||b===this.element)return!0;if(!p.has(b)){let c=b.getBoundingClientRect(),h=c.height===0||c.bottom>=d-16&&c.top<=u+16;if(!h&&m){let x=getComputedStyle(b);h=x.display==="inline"||x.display==="contents"||!x.width.endsWith("px")||!x.height.endsWith("px")}p.set(b,h)}return p.get(b)};this.busy=!0;try{let g=await Yt(this.element,{width:i,height:a,pixelRatio:Math.min(devicePixelRatio||1,1.5),fontEmbedCSS:"",filter:v,style:{height:`${o}px`,transform:`translateY(${-l}px)`,translate:"none",transformOrigin:"top left",position:"static",margin:"0"}});if(this.disposed||f!==this.revision){g.width=0;return}this.capture.cache.set(this.element,{canvas:g,w:g.width,h:g.height,offsetTop:l,cssHeight:a}),s&&(s.canvas.width=0),this.dirty=!1,this.listeners.forEach(b=>b())}catch(g){this.listeners.forEach(b=>b(g))}finally{this.busy=!1}}dispose(){this.disposed=!0,clearTimeout(this.timer),this.observer.disconnect(),this.portals.disconnect(),this.resize.disconnect(),this.element.removeEventListener("load",this.changed,!0),this.element.removeEventListener("input",this.changed,!0),document.removeEventListener("pointerdown",this.interacting,!0),document.removeEventListener("touchstart",this.interacting,!0),document.removeEventListener("click",this.interacting,!0),window.removeEventListener("scroll",this.interacting),window.removeEventListener("resize",this.changed),window.visualViewport?.removeEventListener("resize",this.changed),this.capture.cache.forEach(e=>{e.canvas.width=0}),this.capture.cache.clear()}};function jt(t,e){let n=ot.get(t);n||(n=new ct(t),ot.set(t,n)),n.listeners.add(e);let r=n;return{capture:r.capture,refresh:r.refresh,release(){r.listeners.delete(e),r.listeners.size||(r.dispose(),ot.delete(t))}}}function Kt(t){let e=!1;for(let n=t;n;n=n.parentElement){let r=getComputedStyle(n);if(e&&(r.transform!=="none"||r.perspective!=="none"||r.filter!=="none"))return!1;r.position==="fixed"&&(e=!0)}return e}function Qt(t,e,n,r,s){let i=new ze,o=r,a=!0,l=!1,d=0,u=n instanceof HTMLVideoElement?n:void 0,f=u??(n instanceof HTMLCanvasElement?n:void 0),m=!1,p=!1,v=U=>{l||s(U)},g=f?void 0:jt(n,U=>{a=!0,U&&!g?.capture.cache.has(n)&&v("capture-failed")}),b={renderer:i,capture:g?.capture??{cache:new Map},markChanged:()=>{a=!0},destroy:()=>i.destroy()},c=n.getBoundingClientRect(),h=c.top+scrollY,x=Kt(n),y=Kt(t),E=document.createElement("div");E.style.cssText="position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none",E.setAttribute("aria-hidden","true"),document.body.append(E);let W=f?void 0:St(b,n,()=>c),X=Ft(b,()=>o),$=i.canvas;$.setAttribute("aria-hidden","true"),$.dataset.liquidGlassWebgl="",$.style.cssText=`display:block;position:absolute;left:-${V}px;top:-${V}px;pointer-events:none`,e.append($);let R=document.createElement("canvas"),M=R.getContext("2d"),J="",ie=-1,_=()=>{m=!1,v("webgl-unavailable")},T=()=>{a=!0,v("pending")};$.addEventListener("webglcontextlost",_),$.addEventListener("webglcontextrestored",T);let N=()=>{a=!0};u?.addEventListener("seeked",N),u?.addEventListener("loadeddata",N);let re=0,I,G=()=>{re++,l||(I=u.requestVideoFrameCallback(G))};u?.requestVideoFrameCallback&&(I=u.requestVideoFrameCallback(G));let Z=()=>{if(!l&&(d=requestAnimationFrame(Z),!(document.hidden||g?.capture.suspended||i.contextLost||p&&!a))){p=!1;try{let U=n.getBoundingClientRect(),ee=t.getBoundingClientRect(),S=scrollY,L=Math.max(0,document.documentElement.scrollHeight-innerHeight),D=S<0||S>L;D||(h=U.top+S),c=new DOMRect(U.left,D&&!x?h-S:U.top,U.width,U.height);let F=g?.capture.cache.get(n);if(F&&(c=new DOMRect(c.left,c.top+F.offsetTop,c.width,F.cssHeight)),g&&(!F||ee.top-20<c.top||ee.bottom+10>c.bottom)){m&&(m=!1,v("pending"));return}let ae=D&&y?E.getBoundingClientRect().top:0,P=new DOMRect(ee.left,ee.top-ae,ee.width,ee.height),j=t.offsetWidth,K=t.offsetHeight;if(!j||!K||!c.width||!c.height)return;let w=Math.min(devicePixelRatio||1,3),te=[P.left-c.left,P.top-c.top,c.width,c.height,j,K,P.width,P.height,w].join(":"),Se=I!==void 0?re:u?.currentTime??0;if(!a&&te===J&&Se===ie&&!(f instanceof HTMLCanvasElement)||u&&u.readyState<2)return;let oe=f??g?.capture.cache.get(n)?.canvas;if(!oe)return;let ge=Math.round((j+V*2)*w),be=Math.round((K+V*2)*w);$.style.width=`${j+V*2}px`,$.style.height=`${K+V*2}px`;let Te=P.width/j,xe=P.height/K,Fe=new DOMRect(P.left,P.top,P.width,P.height),$e=Te===1&&xe===1&&W?.(Fe,V);if(!$e&&W&&(Te!==1||xe!==1)&&W(void 0,V),!$e){R.width!==ge||R.height!==be?(R.width=ge,R.height=be):M.clearRect(0,0,ge,be);let ve=(c.left-P.left)/Te*w+V*w,_e=(c.top-P.top)/xe*w+V*w,C=c.width/Te*w,B=c.height/xe*w;if(f){let q=u?.videoWidth??f.width,z=u?.videoHeight??f.height;if(!q||!z)return;let k=getComputedStyle(n),he=C,ne=B;if(k.objectFit!=="fill"){let le=k.objectFit==="cover"?Math.max(C/q,B/z):k.objectFit==="none"?w:Math.min(C/q,B/z,k.objectFit==="scale-down"?w:1/0);he=q*le,ne=z*le}let He=k.objectPosition.split(" "),Pe=(le,ce)=>le.endsWith("%")?parseFloat(le)/100*ce:parseFloat(le)*w||0;M.save(),M.beginPath(),M.rect(ve,_e,C,B),M.clip(),M.drawImage(f,ve+Pe(He[0],C-he),_e+Pe(He[1]??"50%",B-ne),he,ne),M.restore()}else M.drawImage(oe,0,_e>0?0:oe.height-1,oe.width,1,ve,0,C,be),M.drawImage(oe,ve,_e,C,B)}i.uploadAndBlur(R,0,0,ge,be,Math.max(0,o.blur)/5),i.clear(),i.renderGlassPanel({...Rt,cornerRadius:o.radius,shadowOpacity:0},j,K,w),a=!1,J=te,ie=Se,X.failed?(v("capture-failed"),m=!1):X.ready&&!m&&(m=!0,v("active"))}catch{p=!0,a=!1,m=!1,v("capture-failed")}}};return g&&!g.capture.cache.has(n)&&g.refresh().catch(()=>{}),d=requestAnimationFrame(Z),{update(U){o=U,a=!0},async refresh(){await g?.refresh(),a=!0},destroy(){l=!0,cancelAnimationFrame(d),$.removeEventListener("webglcontextlost",_),$.removeEventListener("webglcontextrestored",T),u?.removeEventListener("seeked",N),u?.removeEventListener("loadeddata",N),I!==void 0&&u?.cancelVideoFrameCallback(I),E.remove(),g?.release(),b.destroy(),R.width=0,R.height=0}}}function Jt(t,e){return!/Android/i.test(t)&&(/iPhone|iPad|iPod/i.test(t)||/Macintosh/i.test(t)&&e>1)}function Zt(t,e,n){return e!=="off"&&e!=="blur"&&(n||t==="webgl")}function sn(t){let e=new Map;return{get(n){let r=e.get(n);return r!==void 0&&(e.delete(n),e.set(n,r)),r},set(n,r){if(e.has(n))e.delete(n);else if(e.size>=t){let s=e.keys().next().value;s!==void 0&&e.delete(s)}e.set(n,r)},get size(){return e.size}}}var an=64,er=sn(an),tr=t=>er.get(t),rr=(t,e)=>er.set(t,e);var nr={material:{strength:.05,specular:1,depth:.5,curvature:.3,bend:.45,bendWidth:.16,sheen:.32,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:.5,glow:.1},loupe:{strength:.14,specular:1.55,depth:.95,curvature:.5,bend:.4,bendWidth:.07,sheen:1.2,sheenWidth:3.5,sheenFalloff:1.7,sheenAngle:0,glowFalloff:.6,glow:.1},player:{strength:.16,specular:1,depth:.2,curvature:.55,bend:.25,bendWidth:.08,sheen:.95,sheenWidth:2,sheenFalloff:1.5,sheenAngle:50,glowFalloff:1.5,glow:.15},track:{strength:.03,specular:1,depth:.3,curvature:.25,bend:.05,bendWidth:.06,sheen:.35,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:1.5,glow:.1}},sr={strength:[0,.5],depth:[0,1],curvature:[0,1],bend:[0,1],bendWidth:[.001,.5],sheen:[0,2],sheenWidth:[0,10],sheenFalloff:[.1,5],sheenAngle:[-360,360],specular:[0,3],glow:[0,1],glowSpread:[.01,2],glowFalloff:[.1,5],brightness:[-1,1]};function ut(t="player",e={}){let n={...nr[t]??nr.player,glowSpread:1,brightness:0};for(let r of Object.keys(sr)){let s=e?.[r];if(typeof s=="number"&&Number.isFinite(s)){let[i,o]=sr[r];n[r]=Math.max(i,Math.min(o,s))}}return n}function ir(t,e,n,r="material",s){let{strength:i,specular:o,brightness:a,...l}=ut(r,s),d=`material-v2:${t}:${e}:${n}:${JSON.stringify(l)}`,u=tr(d);if(u)return u;if(typeof document>"u")return"";let f=Lt(512);try{let m=f.generate({lensHalfWidth:t/2,lensHalfHeight:e/2,borderRadius:n,...l,clipToShape:!0,softEdge:!0});return rr(d,m),m}finally{f.dispose()}}function dt(t,e,n){if(typeof n=="number"&&Number.isFinite(n))return Math.max(0,Math.min(.45,n));if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return .06;let r=1.5*.5*t/e;return Math.max(.06,Math.min(.45,r))}function ar(t,e,n){if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return 1;let s=dt(t,e,n)*e;return Math.max(0,Math.min(1,s/(1.5*.5*t)))}var on=["classic","convex","shift","rim"];function or(t){return typeof t=="string"&&on.includes(t)}function ln(t,e,n,r){let s=Math.max(8,Math.round(t/n/r)*r),i=Math.max(8,Math.round(e/n/r)*r);return{newwidth:s,newheight:i}}function ft(t){let n=((typeof t=="number"&&Number.isFinite(t)?t:0)%360+360)%360;return Math.round(n*1e3)/1e3}function cn(t){let e=t!==0?` gradientTransform="rotate(${t} 0.5 0.5)"`:"";return`          <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>`}function un(t,e,n){let r=t/2,s=e/2,i=Math.max(t,e),o=Math.round(255*t/i),a=Math.round(255*e/i),l=n!==0?` gradientTransform="rotate(${n} ${r} ${s})"`:"";return`          <linearGradient id="red" gradientUnits="userSpaceOnUse" x1="${t}" y1="${s}" x2="0" y2="${s}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(${o},0,0)"/>
          </linearGradient>
          <linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="${r}" y1="0" x2="${r}" y2="${e}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(0,0,${a})"/>
          </linearGradient>`}var dn=.3,fn=.66,hn=.42,mn=.5;function pn(t,e,n,r,s,i,o){let a=i*t,l=o*e,d=Math.max(8,Math.min(t,e)*fn),u=s>0?Math.min(.5,dn*s):0,f=Math.round((.5+u)*255),m=Math.round((.5-u)*255),p=r!==0?` gradientTransform="rotate(${r} ${a} ${l})"`:"",v=u>0?`<linearGradient id="cvxRed" gradientUnits="userSpaceOnUse" x1="${a-d}" y1="${l}" x2="${a+d}" y2="${l}"${p}><stop offset="0%" stop-color="rgb(${f},0,0)"/><stop offset="100%" stop-color="rgb(${m},0,0)"/></linearGradient>`:'<linearGradient id="cvxRed"><stop offset="0%" stop-color="rgb(128,0,0)"/></linearGradient>',g=u>0?`<linearGradient id="cvxBlue" gradientUnits="userSpaceOnUse" x1="${a}" y1="${l-d}" x2="${a}" y2="${l+d}"${p}><stop offset="0%" stop-color="rgb(0,0,${f})"/><stop offset="100%" stop-color="rgb(0,0,${m})"/></linearGradient>`:'<linearGradient id="cvxBlue"><stop offset="0%" stop-color="rgb(0,0,128)"/></linearGradient>',b=`${v}
          ${g}
          <radialGradient id="cvxEnv" gradientUnits="userSpaceOnUse" cx="${a}" cy="${l}" r="${d}" fx="${a}" fy="${l}"><stop offset="0%" stop-color="#fff"/><stop offset="40%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>
          <mask id="cvxMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#cvxEnv)"/></mask>`,c=`<rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
        <g>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(128,0,0)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxRed)" mask="url(#cvxMask)"/>
        </g>
        <g style="mix-blend-mode: difference">
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(0,0,128)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxBlue)" mask="url(#cvxMask)"/>
        </g>`;return{defs:b,body:c}}function gn(t,e,n,r,s,i){let o=s*Math.PI/180,a=Math.max(0,Math.min(.5,.5*mn*i)),l=Math.round((.5+a*Math.cos(o))*255),d=Math.round((.5+a*Math.sin(o))*255),u=Math.min(t,e)/2-.5,f=Math.max(1,Math.min(n,u/3)),m=`<mask id="shiftMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="black"/><rect x="${f}" y="${f}" width="${t-f*2}" height="${e-f*2}" rx="${Math.max(0,r-f)}" fill="white" style="filter:blur(${f}px)"/></mask>`,p=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="rgb(${l},0,${d})" mask="url(#shiftMask)"/>`;return{defs:m,body:p}}function bn(t,e,n,r,s,i,o,a){let l=o*t,d=a*e,u=Math.min(1,Math.max(0,i)),f=Math.round(127*hn*u),m=Math.min(255,128+f),p=Math.max(0,128-f),v=Math.min(t,e)/2,g=Math.max(n*1.6,Math.min(t,e)*.4),c=(100*Math.max(0,v-g*u)/v).toFixed(2),h=s!==0?` gradientTransform="rotate(${s} ${l} ${d})"`:"",x=`<linearGradient id="rimRed" gradientUnits="userSpaceOnUse" x1="0" y1="${d}" x2="${t}" y2="${d}"${h}><stop offset="0%" stop-color="rgb(${p},0,0)"/><stop offset="50%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(${m},0,0)"/></linearGradient>
          <linearGradient id="rimBlue" gradientUnits="userSpaceOnUse" x1="${l}" y1="0" x2="${l}" y2="${e}"${h}><stop offset="0%" stop-color="rgb(0,0,${p})"/><stop offset="50%" stop-color="rgb(0,0,128)"/><stop offset="100%" stop-color="rgb(0,0,${m})"/></linearGradient>
          <radialGradient id="rimRadial" gradientUnits="userSpaceOnUse" cx="${l}" cy="${d}" r="${v}"${h}><stop offset="0%" stop-color="#000"/><stop offset="${c}%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></radialGradient>
          <mask id="rimMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#rimRadial)"/></mask>`,y=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <g mask="url(#rimMask)">
          <rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimRed)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimBlue)" style="mix-blend-mode: screen"/>
        </g>`;return{defs:x,body:y}}function xn(t){let{width:e,height:n,divisor:r,quantStep:s,radius:i,border:o,lightness:a,alpha:l,displace:d}=t,u=t.blend??"difference",f=ft(t.angle),m=t.shapeAdapt!==!1,p=t.lens??"classic",v=typeof t.lensStrength=="number"&&Number.isFinite(t.lensStrength)?Math.max(0,t.lensStrength):1,g=t.lensCenter?t.lensCenter[0]:.5,b=t.lensCenter?t.lensCenter[1]:.5,{newwidth:c,newheight:h}=ln(e,n,r,s),x=Math.min(c,h)*(o*.5),y=Math.min(i,e/2,n/2)/r;if(p!=="classic"){let $=`<rect x="${x}" y="${x}" width="${c-x*2}" height="${h-x*2}" rx="${y}" fill="hsl(0 0% ${a}% / ${l})" style="filter:blur(${d}px)" />`,R;p==="convex"?R=pn(c,h,y,f,v,g,b):p==="shift"?R=gn(c,h,x,y,f,v):R=bn(c,h,x,y,f,v,g,b);let M=p==="rim"?R.body:`${R.body}
        ${$}`;return`
      <svg viewBox="0 0 ${c} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${R.defs}
        </defs>
        ${M}
      </svg>
    `}let E=`<rect x="${x}" y="${x}" width="${c-x*2}" height="${h-x*2}" rx="${y}" fill="hsl(0 0% ${a}% / ${l})" style="filter:blur(${d}px)" />`;if(m){let $=un(c,h,f),R=Math.min(e,n),M=Number.isFinite(t.scale)?t.scale:0,J=dt(M,R,t.edgeFeather),ie=ar(M,R,t.edgeFeather),_=Math.min(c,h),T=Math.max(.5,J*_),N=Math.max(0,y-T),re=Math.max(.5,T*.5),I=Math.max(.6,_*.01),G=ie<.999?` opacity="${Math.round(ie*1e3)/1e3}"`:"";return`
      <svg viewBox="0 0 ${c} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${$}
          <mask id="clsEnv" maskUnits="userSpaceOnUse" x="0" y="0" width="${c}" height="${h}">
            <rect x="0" y="0" width="${c}" height="${h}" fill="#000"/>
            <rect x="${T}" y="${T}" width="${c-T*2}" height="${h-T*2}" rx="${N}" fill="white" style="filter:blur(${re}px)"/>
          </mask>
        </defs>
        <rect x="0" y="0" width="${c}" height="${h}" fill="rgb(128,128,128)"/>
        <g${G}>
          <g mask="url(#clsEnv)" style="filter:blur(${I}px)">
            <rect x="0" y="0" width="${c}" height="${h}" rx="${y}" fill="url(#red)" />
            <rect x="0" y="0" width="${c}" height="${h}" rx="${y}" fill="url(#blue)" style="mix-blend-mode: ${u}" />
          </g>
        </g>
        ${E}
      </svg>
    `}let W=cn(f),X=Math.max(.6,Math.min(c,h)*.01);return`
      <svg viewBox="0 0 ${c} ${h}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${W}
        </defs>
        <rect x="0" y="0" width="${c}" height="${h}" fill="black"/>
        <g style="filter:blur(${X}px)">
          <rect x="0" y="0" width="${c}" height="${h}" rx="${y}" fill="url(#red)" />
          <rect x="0" y="0" width="${c}" height="${h}" rx="${y}" fill="url(#blue)" style="mix-blend-mode: ${u}" />
        </g>
        ${E}
      </svg>
    `}function lr(t){return`data:image/svg+xml,${encodeURIComponent(xn(t))}`}var vn=["ripple","flow","wobble"];function ur(t){return typeof t=="string"&&vn.includes(t)}var Qe={ripple:{baseFrequencyX:.012,baseFrequencyY:.012,numOctaves:2,scale:15,seed:3,ampX:.004,ampY:.004,rateX:1.3,rateY:1.1},flow:{baseFrequencyX:.01,baseFrequencyY:.016,numOctaves:2,scale:18,seed:7,ampX:.006,ampY:0,rateX:.7,rateY:0},wobble:{baseFrequencyX:.006,baseFrequencyY:.006,numOctaves:1,scale:28,seed:11,ampX:.0022,ampY:.0022,rateX:.55,rateY:.5}},cr=t=>Math.round(t*1e4)/1e4;function dr(t,e={}){let n=Qe[t]??Qe.ripple,r=e.scale!=null&&Number.isFinite(e.scale)?e.scale:n.scale;return e.maxScale!=null&&Number.isFinite(e.maxScale)&&(r=Math.min(r,e.maxScale)),r=Math.max(0,r),{baseFrequencyX:n.baseFrequencyX,baseFrequencyY:n.baseFrequencyY,numOctaves:n.numOctaves,scale:r,seed:n.seed}}function fr(t,e,n=1){let r=Qe[t]??Qe.ripple,s=(Number.isFinite(e)?e:0)*(Number.isFinite(n)?n:1),i=r.baseFrequencyX+r.ampX*Math.sin(s*r.rateX),o=r.ampY?r.baseFrequencyY+r.ampY*Math.cos(s*r.rateY):r.baseFrequencyY;return[cr(Math.max(1e-4,i)),cr(Math.max(1e-4,o))]}var hr="liquid-glass",_n=0;function yn(){if(typeof navigator>"u")return!1;let t=navigator.userAgent||"";return/(iphone|ipad|ipod)/i.test(t)||/firefox|fxios/i.test(t)?!1:/(chrome|chromium|edg|opr)\//i.test(t)}function H(t,e,n){let r=parseFloat(t.getAttribute(e)||"");return Number.isFinite(r)?r:n}var wn="linear-gradient(135deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.06) 16%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.12) 100%)",En=typeof HTMLElement>"u"?class{}:HTMLElement,Je=class extends En{static get observedAttributes(){return["renderer","effect-mode","backdrop-selector","backdrop-version","lens-profile","strength","dispersion","radius","frost","blur","saturation","displace","scale","border-color","lightness","alpha","angle","shape-adapt","lens","lens-strength","lens-center","liquid","liquid-speed","liquid-scale"]}filterId=`lg-wc-${++_n}`;root;ro;resizeFrame=0;liquidRaf=0;webgl;refreshBackdrop(){return this.webgl?.refresh()??Promise.resolve()}constructor(){super(),this.root=this.attachShadow({mode:"open"})}connectedCallback(){this.render(),typeof ResizeObserver<"u"&&(this.ro=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame),this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=0,this.isConnected&&this.render()})}),this.ro.observe(this))}disconnectedCallback(){this.webgl?.destroy(),this.webgl=void 0,this.ro?.disconnect(),cancelAnimationFrame(this.resizeFrame),this.liquidRaf&&cancelAnimationFrame(this.liquidRaf)}attributeChangedCallback(){this.isConnected&&this.render()}render(){this.webgl?.destroy(),this.webgl=void 0;let e=H(this,"radius",50),n=H(this,"frost",.1),r=H(this,"blur",0),s=H(this,"saturation",140),i=H(this,"displace",5),o=H(this,"scale",160),a=H(this,"lightness",53),l=H(this,"alpha",.9),d=.05,u=this.getAttribute("border-color")||"rgba(120, 120, 120, 0.7)",f=ft(H(this,"angle",0)),m=this.getAttribute("shape-adapt")!=="false",p=this.getAttribute("lens"),v=or(p)?p:"classic",g=H(this,"lens-strength",1),b=this.getAttribute("lens-center"),c=(()=>{if(!b)return;let S=b.split(/[ ,]+/).map(parseFloat);return S.length===2&&S.every(Number.isFinite)?[S[0],S[1]]:void 0})(),h=this.getAttribute("liquid"),x=ur(h)?h:null,y=H(this,"liquid-speed",1),E=this.getAttribute("liquid-scale")!=null?H(this,"liquid-scale",NaN):void 0,W=typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches,X=!!x&&!W,$=this.getBoundingClientRect(),R=$.width||300,M=$.height||180,J=this.getAttribute("renderer"),ie=J==="webgl"||J==="svg"?J:"auto",_=this.getAttribute("effect-mode"),T=_==="blur"||_==="off"||_==="svg"?_:"auto",N=Jt(navigator.userAgent,navigator.maxTouchPoints||0),re=Zt(ie,T,N),I=yn()&&!re&&T!=="blur"&&T!=="off",G,Z,U="";if(I){let S=lr({width:R,height:M,divisor:3,quantStep:24,radius:e,border:d,lightness:a,alpha:l,displace:i,blend:"difference",angle:f,shapeAdapt:m,lens:v,lensStrength:g,lensCenter:c,scale:o});G=`saturate(${s}%) url(#${this.filterId})`,Z=`hsl(0 0% 100% / ${n})`;let L="",D="";if(X&&x){let F=dr(x,{speed:y,scale:E});L=' result="lqBase"',D=`<feTurbulence type="fractalNoise" baseFrequency="${F.baseFrequencyX} ${F.baseFrequencyY}" numOctaves="${F.numOctaves}" seed="${F.seed}" result="lqNoise" data-lg-turb="1"/><feDisplacementMap in="lqBase" in2="lqNoise" scale="${F.scale}" xChannelSelector="R" yChannelSelector="G"/>`}U=`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${this.filterId}" color-interpolation-filters="sRGB"><feImage href="${S}" x="0" y="0" width="100%" height="100%" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${o}" xChannelSelector="R" yChannelSelector="B" result="out"/><feGaussianBlur in="out" stdDeviation="${r}"${L}/>${D}</filter></svg>`}else G=`blur(${Math.max(r,9)}px) saturate(${Math.max(s,160)}%) brightness(1.04)`,Z=`${wn}, hsl(0 0% 100% / ${n})`;if(T==="off"&&(G="none",Z="transparent"),delete this.dataset.glassReason,this.dataset.glassStrategy=T==="off"?"off":I?"svg":"blur",this.root.innerHTML=`
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
    `,re){let S=null;try{let L=this.getAttribute("backdrop-selector");L&&(S=document.querySelector(L))}catch{this.dataset.glassReason="invalid-selector"}if(!S||S.contains(this)||this.contains(S))this.dataset.glassReason||=S?"invalid-backdrop":"missing-backdrop";else{let L=document.createElement("div");L.style.cssText=`position:absolute;inset:0;border-radius:${e}px;overflow:hidden;pointer-events:none;visibility:hidden`,L.setAttribute("aria-hidden","true"),this.root.prepend(L);let D=this.getAttribute("lens-profile"),F=D==="material"||D==="loupe"||D==="track"?D:"player",ae=ut(F,this.hasAttribute("strength")?{strength:H(this,"strength",.16)}:void 0),P=this.offsetWidth||R,j=this.offsetHeight||M;try{this.webgl=Qt(this,L,S,{map:ir(P,j,e,F,ae),scale:o/160*ae.strength*(F==="player"?500:Math.hypot(P,j)/Math.SQRT2),dispersion:Math.min(1,Math.abs(H(this,"dispersion",50))/50),specular:ae.specular,classic:!1,radius:e,blur:r,saturation:s},K=>{let w=K==="active";this.dataset.glassStrategy=w?"webgl":K==="pending"?"pending":"blur",this.dataset.glassReason=w?N?"ios-webgl":"webgl-requested":K,L.style.visibility=w?"visible":"hidden";let te=this.root.querySelector(".lg-glass");te.style.backdropFilter=w?"none":G,te.style.setProperty("-webkit-backdrop-filter",w?"none":G),te.style.background=w?`hsl(0 0% 100% / ${n})`:Z})}catch{this.dataset.glassReason="webgl-unavailable"}}}let ee=this.root.querySelector(".lg-border");if(ee&&(ee.style.background=`linear-gradient(315deg, ${u} 0%, rgba(120,120,120,0) 30%, rgba(120,120,120,0) 70%, ${u} 100%) border-box`),this.liquidRaf&&(cancelAnimationFrame(this.liquidRaf),this.liquidRaf=0),X&&x){let S=this.root.querySelector("[data-lg-turb]");if(S){let L=0,D=F=>{L||(L=F);let[ae,P]=fr(x,(F-L)/1e3,y);S.setAttribute("baseFrequency",`${ae} ${P}`),this.liquidRaf=requestAnimationFrame(D)};this.liquidRaf=requestAnimationFrame(D)}}}};function Rn(t=hr){typeof window>"u"||!window.customElements||customElements.get(t)||customElements.define(t,t===hr?Je:class extends Je{})}Rn();})();
/*! Copyright (c) 2026 Sam Asante. MIT; see THIRD_PARTY_NOTICES.md. */

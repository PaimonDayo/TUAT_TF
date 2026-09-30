(()=>{var Ie=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
	v_uv = a_pos * 0.5 + 0.5;
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`,Et=`
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec2 v_uv;
void main() {
	gl_FragColor = texture2D(u_tex, v_uv * u_scale + u_offset);
}`,Rt=`
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
}`,St=`
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
}`;var Tt={blurAmount:0,refraction:.69,chromAberration:.05,edgeHighlight:.05,specular:0,fresnel:1,distortion:0,cornerRadius:65,zRadius:40,opacity:1,saturation:0,tintStrength:0,brightness:0,shadowOpacity:.3,shadowSpread:10,shadowOffsetY:1,floating:!1,button:!1,bevelMode:0},Ne=6,K=20;var ze=class{constructor(){this.fboCache=new Map;this.activeFBOs=null;this.bgTex=null;this.width=0;this.height=0;this.contextLost=!1;this.canvas=document.createElement("canvas"),this.canvas.style.display="none",this.cropCanvas=document.createElement("canvas"),this.cropCtx=this.cropCanvas.getContext("2d");let e=this.canvas.getContext("webgl",{alpha:!0,premultipliedAlpha:!1,antialias:!1,preserveDrawingBuffer:!0});if(!e)throw new Error("LiquidGlass: WebGL is not supported in this browser.");this.gl=e,this._initPrograms(),this._initBuffers(),this._onContextLost=n=>{n.preventDefault(),this.contextLost=!0,console.warn("LiquidGlass: WebGL context lost.")},this._onContextRestored=()=>{console.info("LiquidGlass: WebGL context restored \u2014 reinitialising."),this.contextLost=!1,this._initPrograms(),this._initBuffers();for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.activeFBOs=null,this.bgTex=null},this.canvas.addEventListener("webglcontextlost",this._onContextLost),this.canvas.addEventListener("webglcontextrestored",this._onContextRestored)}_initPrograms(){this.blitP=this._link(Ie,Et),this.blitU=this._uloc(this.blitP,["u_tex","u_scale","u_offset"]),this.blurP=this._link(Ie,Rt),this.blurU=this._uloc(this.blurP,["u_tex","u_dir"]),this.glassP=this._link(Xe,St),this.glassU=this._uloc(this.glassP,["u_bgTex","u_blurTex","u_center","u_size","u_radius","u_res","u_pad","u_refract","u_chroma","u_edgeHL","u_spec","u_fresnel","u_distort","u_alpha","u_sat","u_tint","u_zRadius","u_brightness","u_shadowAlpha","u_shadowSpread","u_shadowOffY","u_bevelMode"])}_initBuffers(){let e=this.gl;this.quadBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),this.panelBuf=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.panelBuf),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]),e.STATIC_DRAW)}resize(e,n){this.width=e,this.height=n;for(let r of this.fboCache.values())this._freeFBOSet(r);this.fboCache.clear(),this.activeFBOs=null,this.canvas.width=0,this.canvas.height=0}uploadAndBlur(e,n,r,s,i,o){if(this.contextLost)return;let a=this.gl;if(!this._setActiveSize(s,i))return;let l=this.width,d=this.height,c=this.activeFBOs,f=e;(n!==0||r!==0||e.width!==l||e.height!==d)&&((this.cropCanvas.width!==l||this.cropCanvas.height!==d)&&(this.cropCanvas.width=l,this.cropCanvas.height=d),this.cropCtx.clearRect(0,0,l,d),this.cropCtx.drawImage(e,-n,-r),f=this.cropCanvas),this.bgTex||(this.bgTex=a.createTexture()),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.bgTex),a.pixelStorei(a.UNPACK_FLIP_Y_WEBGL,!0),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,a.RGBA,a.UNSIGNED_BYTE,f),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MIN_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_MAG_FILTER,a.LINEAR),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_S,a.CLAMP_TO_EDGE),a.texParameteri(a.TEXTURE_2D,a.TEXTURE_WRAP_T,a.CLAMP_TO_EDGE),a.pixelStorei(a.UNPACK_FLIP_Y_WEBGL,!1),a.bindFramebuffer(a.FRAMEBUFFER,c.bg.fbo),a.viewport(0,0,l,d),a.useProgram(this.blitP),a.activeTexture(a.TEXTURE0),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.bgTex),a.uniform1i(this.blitU.u_tex,0),a.uniform2f(this.blitU.u_scale,1,1),a.uniform2f(this.blitU.u_offset,0,0),this._drawQuad(this.blitP,this.quadBuf);let h=c.blurA.w,p=c.blurA.h;if(a.bindFramebuffer(a.FRAMEBUFFER,c.blurA.fbo),a.viewport(0,0,h,p),a.bindTexture(a.TEXTURE_2D,c.bg.tex),this._drawQuad(this.blitP,this.quadBuf),o>0){let v=o*2.5;a.useProgram(this.blurP),a.uniform1i(this.blurU.u_tex,0);for(let g=0;g<Ne;g++)a.bindFramebuffer(a.FRAMEBUFFER,c.blurB.fbo),a.viewport(0,0,h,p),a.bindTexture(a.TEXTURE_2D,c.blurA.tex),a.uniform2f(this.blurU.u_dir,v/h,0),this._drawQuad(this.blurP,this.quadBuf),a.bindFramebuffer(a.FRAMEBUFFER,c.blurA.fbo),a.bindTexture(a.TEXTURE_2D,c.blurB.tex),a.uniform2f(this.blurU.u_dir,0,v/p),this._drawQuad(this.blurP,this.quadBuf)}}renderGlassPanel(e,n,r,s){if(this.contextLost)return;let i=this.gl,o=this.width,a=this.height,l=this.activeFBOs;i.enable(i.BLEND),i.blendFunc(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA),i.useProgram(this.glassP),i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,l.bg.tex),i.uniform1i(this.glassU.u_bgTex,0),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,l.blurA.tex),i.uniform1i(this.glassU.u_blurTex,1),i.bindFramebuffer(i.FRAMEBUFFER,null),i.viewport(0,this.canvas.height-a,o,a),i.uniform2f(this.glassU.u_res,o,a),i.uniform2f(this.glassU.u_center,o*.5,a*.5),i.uniform2f(this.glassU.u_size,n*s,r*s),i.uniform1f(this.glassU.u_radius,e.cornerRadius*s),i.uniform1f(this.glassU.u_pad,K*s),i.uniform1f(this.glassU.u_refract,e.refraction),i.uniform1f(this.glassU.u_chroma,e.chromAberration),i.uniform1f(this.glassU.u_edgeHL,e.edgeHighlight),i.uniform1f(this.glassU.u_spec,e.specular),i.uniform1f(this.glassU.u_fresnel,e.fresnel),i.uniform1f(this.glassU.u_distort,e.distortion),i.uniform1f(this.glassU.u_alpha,e.opacity),i.uniform1f(this.glassU.u_sat,e.saturation),i.uniform1f(this.glassU.u_tint,e.tintStrength),i.uniform1f(this.glassU.u_zRadius,e.zRadius*s),i.uniform1f(this.glassU.u_brightness,e.brightness),i.uniform1f(this.glassU.u_shadowAlpha,e.shadowOpacity),i.uniform1f(this.glassU.u_shadowSpread,e.shadowSpread*s),i.uniform1f(this.glassU.u_shadowOffY,e.shadowOffsetY*s),i.uniform1f(this.glassU.u_bevelMode,e.bevelMode),this._drawQuad(this.glassP,this.panelBuf),i.disable(i.BLEND)}clear(){let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,this.canvas.height-this.height,this.width,this.height),e.enable(e.SCISSOR_TEST),e.scissor(0,this.canvas.height-this.height,this.width,this.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),e.disable(e.SCISSOR_TEST)}destroy(){if(this.canvas.removeEventListener("webglcontextlost",this._onContextLost),this.canvas.removeEventListener("webglcontextrestored",this._onContextRestored),!this.contextLost){let e=this.gl;for(let n of this.fboCache.values())this._freeFBOSet(n);this.fboCache.clear(),this.bgTex&&e.deleteTexture(this.bgTex),e.deleteBuffer(this.quadBuf),e.deleteBuffer(this.panelBuf),e.deleteProgram(this.blitP),e.deleteProgram(this.blurP),e.deleteProgram(this.glassP)}this.canvas.remove()}_setActiveSize(e,n){if(e<=0||n<=0)return!1;this.width=e,this.height=n,(this.canvas.width!==e||this.canvas.height!==n)&&(this.canvas.width=e,this.canvas.height=n);let r=`${e}x${n}`,s=this.fboCache.get(r);if(!s){for(let i of this.fboCache.values())this._freeFBOSet(i);this.fboCache.clear(),s={bg:this._makeFBO(e,n),blurA:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2)),blurB:this._makeFBO(Math.ceil(e/2),Math.ceil(n/2))},this.fboCache.set(r,s)}return this.activeFBOs=s,!0}_makeFBO(e,n){let r=this.gl,s=r.createTexture();r.bindTexture(r.TEXTURE_2D,s),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,e,n,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);let i=r.createFramebuffer();return r.bindFramebuffer(r.FRAMEBUFFER,i),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,s,0),r.bindFramebuffer(r.FRAMEBUFFER,null),{fbo:i,tex:s,w:e,h:n}}_freeFBO(e){if(!e)return;let n=this.gl;n.deleteFramebuffer(e.fbo),n.deleteTexture(e.tex)}_freeFBOSet(e){this._freeFBO(e.bg),this._freeFBO(e.blurA),this._freeFBO(e.blurB)}_compile(e,n){let r=this.gl,s=r.createShader(n);return r.shaderSource(s,e),r.compileShader(s),r.getShaderParameter(s,r.COMPILE_STATUS)?s:(console.error("LiquidGlass shader compile error:",r.getShaderInfoLog(s),e),null)}_link(e,n){let r=this.gl,s=r.createProgram();return r.attachShader(s,this._compile(e,r.VERTEX_SHADER)),r.attachShader(s,this._compile(n,r.FRAGMENT_SHADER)),r.linkProgram(s),r.getProgramParameter(s,r.LINK_STATUS)||console.error("LiquidGlass program link error:",r.getProgramInfoLog(s)),s}_uloc(e,n){let r=this.gl,s={};for(let i of n)s[i]=r.getUniformLocation(e,i);return s}_drawQuad(e,n){let r=this.gl,s=r.getAttribLocation(e,"a_pos");r.bindBuffer(r.ARRAY_BUFFER,n),r.enableVertexAttribArray(s),r.vertexAttribPointer(s,2,r.FLOAT,!1,0,0),r.drawArrays(r.TRIANGLE_STRIP,0,4)}};function Mt(t,e,n=()=>e.getBoundingClientRect()){let r=t.renderer,s=r.gl,i,o=null,a=null,l={},d=s.getParameter(s.MAX_TEXTURE_SIZE),c=r.uploadAndBlur.bind(r),f,h=()=>{i=void 0,o=null,a=null};r.canvas.addEventListener("webglcontextrestored",h);let p=()=>{r.canvas.removeEventListener("webglcontextrestored",h),o&&s.deleteTexture(o),a&&s.deleteProgram(a)},v=t.destroy.bind(t);return t.destroy=()=>{p(),v()},r.uploadAndBlur=(g,y,u,m,b,_)=>{if(!f)return c(g,y,u,m,b,_);if(r.contextLost||!r._setActiveSize(m,b))return;let w=r.activeFBOs;if(a||(a=r._link(Ie,`precision highp float;
        uniform sampler2D u_tex; uniform vec2 u_scale; uniform vec2 u_offset; varying vec2 v_uv;
        void main() { vec2 uv = v_uv * u_scale + u_offset;
          gl_FragColor = texture2D(u_tex, clamp(uv, vec2(0.0), vec2(1.0))); }`),l=r._uloc(a,["u_tex","u_scale","u_offset"])),s.bindFramebuffer(s.FRAMEBUFFER,w.bg.fbo),s.viewport(0,0,m,b),s.useProgram(a),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,o),s.uniform1i(l.u_tex,0),s.uniform2f(l.u_scale,f.w,f.h),s.uniform2f(l.u_offset,f.x,f.y),r._drawQuad(a,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,w.blurA.fbo),s.viewport(0,0,w.blurA.w,w.blurA.h),s.useProgram(r.blitP),s.bindTexture(s.TEXTURE_2D,w.bg.tex),s.uniform1i(r.blitU.u_tex,0),s.uniform2f(r.blitU.u_scale,1,1),s.uniform2f(r.blitU.u_offset,0,0),r._drawQuad(r.blitP,r.quadBuf),_>0){let q=_*2.5;s.useProgram(r.blurP),s.uniform1i(r.blurU.u_tex,0);for(let z=0;z<Ne;z++)s.bindFramebuffer(s.FRAMEBUFFER,w.blurB.fbo),s.bindTexture(s.TEXTURE_2D,w.blurA.tex),s.uniform2f(r.blurU.u_dir,q/w.blurA.w,0),r._drawQuad(r.blurP,r.quadBuf),s.bindFramebuffer(s.FRAMEBUFFER,w.blurA.fbo),s.bindTexture(s.TEXTURE_2D,w.blurB.tex),s.uniform2f(r.blurU.u_dir,0,q/w.blurA.h),r._drawQuad(r.blurP,r.quadBuf)}},(g,y)=>{if(f=void 0,!g)return!1;let u=t.capture.cache.get(e)?.canvas;if(!u||u.width>d||u.height>d||u.width*u.height*4>64*1024*1024||r.contextLost)return!1;u!==i&&(o||=s.createTexture(),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,o),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,1),s.texImage2D(s.TEXTURE_2D,0,s.RGBA,s.RGBA,s.UNSIGNED_BYTE,u),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,0),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MAG_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE),i=u);let m=n();return f={x:(g.left-y-m.left)/m.width,y:1-(g.bottom+y-m.top)/m.height,w:(g.width+y*2)/m.width,h:(g.height+y*2)/m.height},!0}}var Ft=.22,gr=Math.sqrt(Math.PI),br=t=>Math.tanh(gr*t),Lt=(t,e)=>e>0?(t-Math.sqrt(t*t-e*e))/e:0,xr=(t,e,n)=>{let r=Math.max(.01,Math.min(t,Math.min(e,n)-1)),s=(e*e+r*r)/(2*r),i=(n*n+r*r)/(2*r),o=Lt(s,e),a=Lt(i,n);return{Rx:s,Ry:i,scaleX:o>0?.5/o:1,scaleY:a>0?.5/a:1}},vr=(t,e,n)=>{let r=Math.min(t,e*.999);return r/Math.sqrt(e*e-r*r)*n};var Ve=t=>(.5+t)*255+.5|0,At=t=>127*t+128+.5|0,Ct=t=>{let e=null,n=null,r=null,s=null,i=-1/0,o=-1/0,a=-1/0,l=0,d=!0,c=null;return{generate(f){e||(e=document.createElement("canvas"),e.width=t,e.height=t,n=e.getContext("2d"),r=n.createImageData(t,t));let{lensHalfWidth:h,lensHalfHeight:p,borderRadius:v,depth:g,clipToShape:y,softEdge:u,sheenAngle:m=45,glow:b=0,glowSpread:_=1,glowFalloff:w=1.5,sheen:q=0,sheenWidth:z=3,sheenFalloff:F=1.5,curvature:E=0,splay:T=0,bend:Z=0,bendWidth:ie=.16}=f,x=r.data,S=t>>1,V=Math.min(v,Math.min(h,p)),re=Math.min(h,p),O=Math.min(g*re,re-1),I=Math.max(0,h-O),ee=Math.max(0,p-O),$=Math.max(0,Math.min(v,Math.min(I,ee))),ae=O>0?Math.SQRT1_2/O:1e6,R=b>0||q>0,L=m*Math.PI/180,U=Math.cos(L),D=Math.sin(L),A=z>0?1/z:0,Y=1/Math.max(2,_*Math.min(h,p)),J=2*h/t,C=2*p/t,H=1/h,te=1/p,oe=E>0,he=E*Math.min(h,p),me=T>0,Se=Z>0,Te=1/Math.max(2,ie*Math.min(h,p)),qe=(P,k)=>P>0||k>0?Math.sqrt(P*P+k*k):0;if(oe&&((!c||Math.abs(he-i)>.5||Math.abs(h-o)>1||Math.abs(p-a)>1)&&(c=xr(he,h,p),i=he,o=h,a=p,d=!0),l!==S&&(s=new Float32Array(S),l=S,d=!0),d)){let P=s,k=c,G=k.Rx*k.Rx,W=k.Rx*(1-.001);for(let X=0;X<S;X+=1){let pe=-((X+.5)*J-h),le=pe<W?pe:W;P[X]=le/Math.sqrt(G-le*le)*k.scaleX}d=!1}let Me=oe?s:null,xe=.5*Math.min(h,p),ve=xe>0?1/xe:0,ne=Math.SQRT1_2;for(let P=0;P<S;P+=1){let k=t-1-P,G=-((P+.5)*C-p),W=G-p+V,X=u?G-ee+$:0,pe=oe&&Me?vr(G,c.Ry,c.scaleY):G*te>1?1:G*te,le=G*te>1?1:G*te,He=me?Math.max(0,1-(p-G)*ve):0,ce=P*t,We=k*t;for(let _e=0;_e<S;_e+=1){let pt=t-1-_e,ye=-((_e+.5)*J-h),Ce=ye-h+V,we=qe(Ce>0?Ce:0,W>0?W:0)+(Ce>W?Ce>0?0:Ce:W>0?0:W)-V,$e=(ce+_e)*4,Pe=(ce+pt)*4,Ue=(We+_e)*4,De=(We+pt)*4;if(y&&we>=0){for(let M of[$e,Pe,Ue,De])x[M]=128,x[M+1]=128,x[M+2]=128,x[M+3]=255;continue}let ue=Me?Me[_e]:ye*H>1?1:ye*H,de=pe;if(me){let M=He*T,se=Math.max(0,1-(h-ye)*ve)*T;if(M>.001||se>.001){let ge=ue,fe=de;ue=ge*(1-M),de=fe*(1-se);let be=Math.sqrt(ge*ge+fe*fe),Oe=Math.sqrt(ue*ue+de*de);if(Oe>.001){let wt=be/Oe;ue*=wt,de*=wt}}}let Be=1;if(u){let M=ye-I+$,se=qe(M>0?M:0,X>0?X:0)+(M>X?M>0?0:M:X>0?0:X)-$;Be=.5*(1+br(se*ae))}let et=.5*ue*Be,tt=.5*de*Be;if(Se){let M=we<0?Math.max(0,1+we*Te):0;if(M>0){let se=Math.sqrt(ue*ue+de*de);if(se>1e-4){let ge=6.75*M*M*(1-M),fe=.5*Z*ge*Be/se;et+=ue*fe,tt+=de*fe}}}let Ee=0,Re=0;if(R){let M=ye*H>1?1:ye*H,se=Math.min(1,Math.abs(M*U+le*D)*ne),ge=Math.min(1,Math.abs(M*U-le*D)*ne);if(q>0){let fe=we<0?Math.max(0,1+we*A):0,be=q*Math.pow(fe,F);Ee+=be*(.16+.84*Math.pow(se,1.6)),Re+=be*(.16+.84*Math.pow(ge,1.6))}if(b>0){let be=1-(we<0?Math.min(1,-we*Y):1),Oe=b*Math.pow(be*be*(3-2*be),w)*Be;Ee+=Oe*(.6+.4*se),Re+=Oe*(.6+.4*ge)}Ee>1?Ee=1:Ee<-1&&(Ee=-1),Re>1?Re=1:Re<-1&&(Re=-1)}let gt=Ve(et),bt=Ve(-et),xt=Ve(tt),vt=Ve(-tt),_t=At(Ee),yt=At(Re);x[$e]=gt,x[$e+1]=xt,x[$e+2]=_t,x[$e+3]=255,x[Pe]=bt,x[Pe+1]=xt,x[Pe+2]=yt,x[Pe+3]=255,x[Ue]=gt,x[Ue+1]=vt,x[Ue+2]=yt,x[Ue+3]=255,x[De]=bt,x[De+1]=vt,x[De+2]=_t,x[De+3]=255}}return n.putImageData(r,0,0),e.toDataURL()},dispose(){e&&(e.width=0,e.height=0,e=null),n=null,r=null,s=null,c=null,i=-1/0,o=-1/0,a=-1/0,l=0,d=!0}}};var _r=`precision highp float;
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
}`;function $t(t,e){let n=t.renderer,r=n.gl,s=n.renderGlassPanel.bind(n),i=null,o=null,a="",l=0,d={},c={ready:!1,failed:!1,mapUploads:0,mapUrl:"",scale:0},f=()=>{i=null,o=null,a="",l++,c.ready=!1};n.canvas.addEventListener("webglcontextrestored",f);let h=t.destroy.bind(t);return t.destroy=()=>{l++,n.canvas.removeEventListener("webglcontextrestored",f),o&&r.deleteTexture(o),h()},n.renderGlassPanel=(p,v,g,y)=>{let u=e(),m=u.map;if(m!==a){a=m,c.failed=!1;let b=++l,_=new Image;_.onload=()=>{b!==l||n.contextLost||(o||=r.createTexture(),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,o),r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,0),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,r.NONE),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,r.RGBA,r.UNSIGNED_BYTE,_),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE),c.ready=!0,c.mapUploads++,c.mapUrl=m,t.markChanged())},_.onerror=()=>{b===l&&(c.failed=!0,t.markChanged())},_.src=m}o&&(i||(i=n._link(Xe,_r),r.deleteProgram(n.glassP),n.glassP=i,n.glassU=n._uloc(i,Object.keys(n.glassU)),d=n._uloc(i,["u_lensMap","u_mapScale","u_mapDispersion","u_mapSpecular","u_classic","u_saturation","u_additive","u_neutral"])),c.scale=u.scale,r.useProgram(i),r.activeTexture(r.TEXTURE2),r.bindTexture(r.TEXTURE_2D,o),r.uniform1i(d.u_lensMap,2),r.uniform1f(d.u_mapScale,c.scale*y),r.uniform1f(d.u_mapDispersion,(u.additiveDispersion??u.classic?y:Ft)*u.dispersion),r.uniform1f(d.u_mapSpecular,u.specular),r.uniform1f(d.u_classic,u.classic?1:0),r.uniform1f(d.u_saturation,u.saturation/100),r.uniform1f(d.u_additive,u.additiveDispersion??u.classic?1:0),r.uniform1f(d.u_neutral,u.neutralPoint??.5),s(p,v,g,y))},c}function Pt(t,e){if(t.match(/^[a-z]+:\/\//i))return t;if(t.match(/^\/\//))return window.location.protocol+t;if(t.match(/^[a-z]+:/i))return t;let n=document.implementation.createHTMLDocument(),r=n.createElement("base"),s=n.createElement("a");return n.head.appendChild(r),n.body.appendChild(s),e&&(r.href=e),s.href=t,s.href}var Ut=(()=>{let t=0,e=()=>`0000${(Math.random()*36**4<<0).toString(36)}`.slice(-4);return()=>(t+=1,`u${e()}${t}`)})();function Q(t){let e=[];for(let n=0,r=t.length;n<r;n++)e.push(t[n]);return e}function Ye(t,e){let r=(t.ownerDocument.defaultView||window).getComputedStyle(t).getPropertyValue(e);return r?parseFloat(r.replace("px","")):0}function yr(t){let e=Ye(t,"border-left-width"),n=Ye(t,"border-right-width");return t.clientWidth+e+n}function wr(t){let e=Ye(t,"border-top-width"),n=Ye(t,"border-bottom-width");return t.clientHeight+e+n}function rt(t,e={}){let n=e.width||yr(t),r=e.height||wr(t);return{width:n,height:r}}function Dt(){let t,e;try{e=process}catch{}let n=e&&e.env?e.env.devicePixelRatio:null;return n&&(t=parseInt(n,10),Number.isNaN(t)&&(t=1)),t||window.devicePixelRatio||1}var j=16384;function Bt(t){(t.width>j||t.height>j)&&(t.width>j&&t.height>j?t.width>t.height?(t.height*=j/t.width,t.width=j):(t.width*=j/t.height,t.height=j):t.width>j?(t.height*=j/t.width,t.width=j):(t.width*=j/t.height,t.height=j))}function Le(t){return new Promise((e,n)=>{let r=new Image;r.decode=()=>e(r),r.onload=()=>e(r),r.onerror=n,r.crossOrigin="anonymous",r.decoding="async",r.src=t})}async function Er(t){return Promise.resolve().then(()=>new XMLSerializer().serializeToString(t)).then(encodeURIComponent).then(e=>`data:image/svg+xml;charset=utf-8,${e}`)}async function Ot(t,e,n){let r="http://www.w3.org/2000/svg",s=document.createElementNS(r,"svg"),i=document.createElementNS(r,"foreignObject");return s.setAttribute("width",`${e}`),s.setAttribute("height",`${n}`),s.setAttribute("viewBox",`0 0 ${e} ${n}`),i.setAttribute("width","100%"),i.setAttribute("height","100%"),i.setAttribute("x","0"),i.setAttribute("y","0"),i.setAttribute("externalResourcesRequired","true"),s.appendChild(i),i.appendChild(t),Er(s)}var B=(t,e)=>{if(t instanceof e)return!0;let n=Object.getPrototypeOf(t);return n===null?!1:n.constructor.name===e.name||B(n,e)};function Rr(t){let e=t.getPropertyValue("content");return`${t.cssText} content: '${e.replace(/'|"/g,"")}';`}function Sr(t){return Q(t).map(e=>{let n=t.getPropertyValue(e),r=t.getPropertyPriority(e);return`${e}: ${n}${r?" !important":""};`}).join(" ")}function Tr(t,e,n){let r=`.${t}:${e}`,s=n.cssText?Rr(n):Sr(n);return document.createTextNode(`${r}{${s}}`)}function It(t,e,n){let r=window.getComputedStyle(t,n),s=r.getPropertyValue("content");if(s===""||s==="none")return;let i=Ut();try{e.className=`${e.className} ${i}`}catch{return}let o=document.createElement("style");o.appendChild(Tr(i,n,r)),e.appendChild(o)}function kt(t,e){It(t,e,":before"),It(t,e,":after")}var Gt="application/font-woff",qt="image/jpeg",Mr={woff:Gt,woff2:Gt,ttf:"application/font-truetype",eot:"application/vnd.ms-fontobject",png:"image/png",jpg:qt,jpeg:qt,gif:"image/gif",tiff:"image/tiff",svg:"image/svg+xml",webp:"image/webp"};function Lr(t){let e=/\.([^./]*?)$/g.exec(t);return e?e[1]:""}function Ae(t){let e=Lr(t).toLowerCase();return Mr[e]||""}function Ar(t){return t.split(/,/)[1]}function ke(t){return t.search(/^(data:)/)!==-1}function st(t,e){return`data:${e};base64,${t}`}async function it(t,e,n){let r=await fetch(t,e);if(r.status===404)throw new Error(`Resource "${r.url}" not found`);let s=await r.blob();return new Promise((i,o)=>{let a=new FileReader;a.onerror=o,a.onloadend=()=>{try{i(n({res:r,result:a.result}))}catch(l){o(l)}},a.readAsDataURL(s)})}var nt={};function Fr(t,e,n){let r=t.replace(/\?.*/,"");return n&&(r=t),/ttf|otf|eot|woff2?/i.test(r)&&(r=r.replace(/.*\//,"")),e?`[${e}]${r}`:r}async function Fe(t,e,n){let r=Fr(t,e,n.includeQueryParams);if(nt[r]!=null)return nt[r];n.cacheBust&&(t+=(/\?/.test(t)?"&":"?")+new Date().getTime());let s;try{let i=await it(t,n.fetchRequestInit,({res:o,result:a})=>(e||(e=o.headers.get("Content-Type")||""),Ar(a)));s=st(i,e)}catch(i){s=n.imagePlaceholder||"";let o=`Failed to fetch resource: ${t}`;i&&(o=typeof i=="string"?i:i.message),o&&console.warn(o)}return nt[r]=s,s}async function Cr(t){let e=t.toDataURL();return e==="data:,"?t.cloneNode(!1):Le(e)}async function $r(t,e){if(t.currentSrc){let i=document.createElement("canvas"),o=i.getContext("2d");i.width=t.clientWidth,i.height=t.clientHeight,o?.drawImage(t,0,0,i.width,i.height);let a=i.toDataURL();return Le(a)}let n=t.poster,r=Ae(n),s=await Fe(n,r,e);return Le(s)}async function Pr(t){var e;try{if(!((e=t?.contentDocument)===null||e===void 0)&&e.body)return await Ge(t.contentDocument.body,{},!0)}catch{}return t.cloneNode(!1)}async function Ur(t,e){return B(t,HTMLCanvasElement)?Cr(t):B(t,HTMLVideoElement)?$r(t,e):B(t,HTMLIFrameElement)?Pr(t):t.cloneNode(!1)}var Dr=t=>t.tagName!=null&&t.tagName.toUpperCase()==="SLOT";async function Br(t,e,n){var r,s;let i=[];return Dr(t)&&t.assignedNodes?i=Q(t.assignedNodes()):B(t,HTMLIFrameElement)&&(!((r=t.contentDocument)===null||r===void 0)&&r.body)?i=Q(t.contentDocument.body.childNodes):i=Q(((s=t.shadowRoot)!==null&&s!==void 0?s:t).childNodes),i.length===0||B(t,HTMLVideoElement)||await i.reduce((o,a)=>o.then(()=>Ge(a,n)).then(l=>{l&&e.appendChild(l)}),Promise.resolve()),e}function Or(t,e){let n=e.style;if(!n)return;let r=window.getComputedStyle(t);r.cssText?(n.cssText=r.cssText,n.transformOrigin=r.transformOrigin):Q(r).forEach(s=>{let i=r.getPropertyValue(s);s==="font-size"&&i.endsWith("px")&&(i=`${Math.floor(parseFloat(i.substring(0,i.length-2)))-.1}px`),B(t,HTMLIFrameElement)&&s==="display"&&i==="inline"&&(i="block"),s==="d"&&e.getAttribute("d")&&(i=`path(${e.getAttribute("d")})`),n.setProperty(s,i,r.getPropertyPriority(s))})}function Ir(t,e){B(t,HTMLTextAreaElement)&&(e.innerHTML=t.value),B(t,HTMLInputElement)&&e.setAttribute("value",t.value)}function kr(t,e){if(B(t,HTMLSelectElement)){let r=Array.from(e.children).find(s=>t.value===s.getAttribute("value"));r&&r.setAttribute("selected","")}}function Gr(t,e){return B(e,Element)&&(Or(t,e),kt(t,e),Ir(t,e),kr(t,e)),e}async function qr(t,e){let n=t.querySelectorAll?t.querySelectorAll("use"):[];if(n.length===0)return t;let r={};for(let i=0;i<n.length;i++){let a=n[i].getAttribute("xlink:href");if(a){let l=t.querySelector(a),d=document.querySelector(a);!l&&d&&!r[a]&&(r[a]=await Ge(d,e,!0))}}let s=Object.values(r);if(s.length){let i="http://www.w3.org/1999/xhtml",o=document.createElementNS(i,"svg");o.setAttribute("xmlns",i),o.style.position="absolute",o.style.width="0",o.style.height="0",o.style.overflow="hidden",o.style.display="none";let a=document.createElementNS(i,"defs");o.appendChild(a);for(let l=0;l<s.length;l++)a.appendChild(s[l]);t.appendChild(o)}return t}async function Ge(t,e,n){return!n&&e.filter&&!e.filter(t)?null:Promise.resolve(t).then(r=>Ur(r,e)).then(r=>Br(t,r,e)).then(r=>Gr(t,r)).then(r=>qr(r,e))}var Ht=/url\((['"]?)([^'"]+?)\1\)/g,Hr=/url\([^)]+\)\s*format\((["']?)([^"']+)\1\)/g,Wr=/src:\s*(?:url\([^)]+\)\s*format\([^)]+\)[,;]\s*)+/g;function Xr(t){let e=t.replace(/([.*+?^${}()|\[\]\/\\])/g,"\\$1");return new RegExp(`(url\\(['"]?)(${e})(['"]?\\))`,"g")}function Nr(t){let e=[];return t.replace(Ht,(n,r,s)=>(e.push(s),n)),e.filter(n=>!ke(n))}async function zr(t,e,n,r,s){try{let i=n?Pt(e,n):e,o=Ae(e),a;if(s){let l=await s(i);a=st(l,o)}else a=await Fe(i,o,r);return t.replace(Xr(e),`$1${a}$3`)}catch{}return t}function Vr(t,{preferredFontFormat:e}){return e?t.replace(Wr,n=>{for(;;){let[r,,s]=Hr.exec(n)||[];if(!s)return"";if(s===e)return`src: ${r};`}}):t}function at(t){return t.search(Ht)!==-1}async function Ke(t,e,n){if(!at(t))return t;let r=Vr(t,n);return Nr(r).reduce((i,o)=>i.then(a=>zr(a,o,e,n)),Promise.resolve(r))}async function je(t,e,n){var r;let s=(r=e.style)===null||r===void 0?void 0:r.getPropertyValue(t);if(s){let i=await Ke(s,null,n);return e.style.setProperty(t,i,e.style.getPropertyPriority(t)),!0}return!1}async function Yr(t,e){await je("background",t,e)||await je("background-image",t,e),await je("mask",t,e)||await je("mask-image",t,e)}async function Kr(t,e){let n=B(t,HTMLImageElement);if(!(n&&!ke(t.src))&&!(B(t,SVGImageElement)&&!ke(t.href.baseVal)))return;let r=n?t.src:t.href.baseVal,s=await Fe(r,Ae(r),e);await new Promise((i,o)=>{t.onload=i,t.onerror=o;let a=t;a.decode&&(a.decode=i),a.loading==="lazy"&&(a.loading="eager"),n?(t.srcset="",t.src=s):t.href.baseVal=s})}async function jr(t,e){let r=Q(t.childNodes).map(s=>ot(s,e));await Promise.all(r).then(()=>t)}async function ot(t,e){B(t,Element)&&(await Yr(t,e),await Kr(t,e),await jr(t,e))}function Wt(t,e){let{style:n}=t;e.backgroundColor&&(n.backgroundColor=e.backgroundColor),e.width&&(n.width=`${e.width}px`),e.height&&(n.height=`${e.height}px`);let r=e.style;return r!=null&&Object.keys(r).forEach(s=>{n[s]=r[s]}),t}var Xt={};async function Nt(t){let e=Xt[t];if(e!=null)return e;let r=await(await fetch(t)).text();return e={url:t,cssText:r},Xt[t]=e,e}async function zt(t,e){let n=t.cssText,r=/url\(["']?([^"')]+)["']?\)/g,i=(n.match(/url\([^)]+\)/g)||[]).map(async o=>{let a=o.replace(r,"$1");return a.startsWith("https://")||(a=new URL(a,t.url).href),it(a,e.fetchRequestInit,({result:l})=>(n=n.replace(o,`url(${l})`),[o,l]))});return Promise.all(i).then(()=>n)}function Vt(t){if(t==null)return[];let e=[],n=/(\/\*[\s\S]*?\*\/)/gi,r=t.replace(n,""),s=new RegExp("((@.*?keyframes [\\s\\S]*?){([\\s\\S]*?}\\s*?)})","gi");for(;;){let l=s.exec(r);if(l===null)break;e.push(l[0])}r=r.replace(s,"");let i=/@import[\s\S]*?url\([^)]*\)[\s\S]*?;/gi,o="((\\s*?(?:\\/\\*[\\s\\S]*?\\*\\/)?\\s*?@media[\\s\\S]*?){([\\s\\S]*?)}\\s*?})|(([\\s\\S]*?){([\\s\\S]*?)})",a=new RegExp(o,"gi");for(;;){let l=i.exec(r);if(l===null){if(l=a.exec(r),l===null)break;i.lastIndex=a.lastIndex}else a.lastIndex=i.lastIndex;e.push(l[0])}return e}async function Qr(t,e){let n=[],r=[];return t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach((i,o)=>{if(i.type===CSSRule.IMPORT_RULE){let a=o+1,l=i.href,d=Nt(l).then(c=>zt(c,e)).then(c=>Vt(c).forEach(f=>{try{s.insertRule(f,f.startsWith("@import")?a+=1:s.cssRules.length)}catch(h){console.error("Error inserting rule from remote css",{rule:f,error:h})}})).catch(c=>{console.error("Error loading remote css",c.toString())});r.push(d)}})}catch(i){let o=t.find(a=>a.href==null)||document.styleSheets[0];s.href!=null&&r.push(Nt(s.href).then(a=>zt(a,e)).then(a=>Vt(a).forEach(l=>{o.insertRule(l,s.cssRules.length)})).catch(a=>{console.error("Error loading remote stylesheet",a)})),console.error("Error inlining remote css file",i)}}),Promise.all(r).then(()=>(t.forEach(s=>{if("cssRules"in s)try{Q(s.cssRules||[]).forEach(i=>{n.push(i)})}catch(i){console.error(`Error while reading CSS rules from ${s.href}`,i)}}),n))}function Jr(t){return t.filter(e=>e.type===CSSRule.FONT_FACE_RULE).filter(e=>at(e.style.getPropertyValue("src")))}async function Zr(t,e){if(t.ownerDocument==null)throw new Error("Provided element is not within a Document");let n=Q(t.ownerDocument.styleSheets),r=await Qr(n,e);return Jr(r)}async function Yt(t,e){let n=await Zr(t,e);return(await Promise.all(n.map(s=>{let i=s.parentStyleSheet?s.parentStyleSheet.href:null;return Ke(s.cssText,i,e)}))).join(`
`)}async function Kt(t,e){let n=e.fontEmbedCSS!=null?e.fontEmbedCSS:e.skipFonts?null:await Yt(t,e);if(n){let r=document.createElement("style"),s=document.createTextNode(n);r.appendChild(s),t.firstChild?t.insertBefore(r,t.firstChild):t.appendChild(r)}}async function en(t,e={}){let{width:n,height:r}=rt(t,e),s=await Ge(t,e,!0);return await Kt(s,e),await ot(s,e),Wt(s,e),await Ot(s,n,r)}async function lt(t,e={}){let{width:n,height:r}=rt(t,e),s=await en(t,e),i=await Le(s),o=document.createElement("canvas"),a=o.getContext("2d"),l=e.pixelRatio||Dt(),d=e.canvasWidth||n,c=e.canvasHeight||r;return o.width=d*l,o.height=c*l,e.skipAutoScale||Bt(o),o.style.width=`${d}`,o.style.height=`${c}`,e.backgroundColor&&(a.fillStyle=e.backgroundColor,a.fillRect(0,0,o.width,o.height)),a.drawImage(i,0,0,o.width,o.height),o}var ct=null;function jt(t){let e=t.match(/font-family\s*:\s*(['"]?)([^;'"]+)\1/i);return e?e[2].trim():""}function tn(t){let e=t.match(/font-weight\s*:\s*([^;]+)/i);return e?e[1].trim():"400"}function rn(t){let e=t.match(/font-style\s*:\s*([^;]+)/i);return e?e[1].trim():"normal"}function nn(t){let e=t.match(/unicode-range\s*:\s*([^;]+)/i);if(!e)return null;let n=[];for(let r of e[1].split(",")){let i=r.trim().match(/U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/);if(!i)continue;let o=parseInt(i[1],16),a=i[2]?parseInt(i[2],16):o;n.push([o,a])}return n.length>0?n:null}function sn(t,e){let n=t.split(/\s+/).map(Number),r=Number(e)||400;return n.length>=2?r>=n[0]&&r<=n[1]:n[0]===r}function an(t,e){for(let n=0;n<t.length;n++){let r=t.codePointAt(n);for(let[s,i]of e)if(r>=s&&r<=i)return!0;r>65535&&n++}return!1}function on(t){let e=new Map,n=[];function r(s){if(s.nodeType===3){let i=s.textContent||"";if(i.trim()==="")return;let o=s.parentElement;if(!o)return;let a=getComputedStyle(o),l=a.fontWeight,d=a.fontStyle;for(let c of a.fontFamily.split(",")){let f=c.replace(/['"]/g,"").trim().toLowerCase(),h=`${f}|${l}|${d}`,p=e.get(h);p!==void 0?n[p].text+=i:(e.set(h,n.length),n.push({family:f,weight:l,style:d,text:i}))}}else if(s.nodeType===1){let i=s;for(let o=0;o<i.childNodes.length;o++)r(i.childNodes[o])}}return r(t),n}function ln(t,e){let n=on(e);return n.length===0?[]:t.filter(r=>{let s=n.filter(i=>i.family!==r.family?!1:(r.style===i.style||r.style==="normal"&&i.style==="normal")&&sn(r.weight,i.weight));return!(s.length===0||r.unicodeRanges&&!s.some(o=>o.text.length>0&&an(o.text,r.unicodeRanges)))})}async function cn(t){try{let e=await fetch(t);if(!e.ok)return null;let n=await e.blob();return new Promise((r,s)=>{let i=new FileReader;i.onload=()=>r(i.result),i.onerror=s,i.readAsDataURL(n)})}catch{return null}}async function un(){let t=[],e=Array.from(document.querySelectorAll('link[rel="stylesheet"]'));for(let i of e)if(i.href)try{let o=await fetch(i.href,{cache:"force-cache"});if(!o.ok)continue;let a=await o.text(),l=new CSSStyleSheet;await l.replace(a);for(let d of l.cssRules)d.type===CSSRule.FONT_FACE_RULE&&t.push(d.cssText)}catch{}for(let i of Array.from(document.styleSheets))if(!i.href)try{for(let o of Array.from(i.cssRules||[]))o.type===CSSRule.FONT_FACE_RULE&&t.push(o.cssText)}catch{}let n=new Set;if(document.fonts)for(let i of document.fonts)i.status==="loaded"&&n.add(i.family.replace(/['"]/g,"").trim().toLowerCase());let r=n.size>0?t.filter(i=>n.has(jt(i).toLowerCase())):t;return await Promise.all(r.map(async i=>{let o=/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g,a=Array.from(i.matchAll(o)),l=i;for(let d of a){let c=d[1];if(c.startsWith("data:"))continue;let f=await cn(c);f&&(l=l.replace(d[0],`url(${f})`))}return{css:l,family:jt(i).toLowerCase(),weight:tn(i),style:rn(i),unicodeRanges:nn(i)}}))}var Qe=class{constructor(e){this.disposed=!1;this._capturing=new Set;this.onCacheUpdate=null;this._fontBlocks=[];this.root=e,this.cache=new Map,this.dpr=1}async prefetchFontEmbedCSS(){ct||(ct=un()),this._fontBlocks=await ct}fontEmbedCSSForElement(e){return this._fontBlocks.length===0?"":ln(this._fontBlocks,e).map(r=>r.css).join(`
`)}resize(e=1){this.dpr=e,this.cache.clear()}async captureElement(e,n=!1){let r=e.offsetWidth,s=e.offsetHeight,i=Math.round(r*this.dpr),o=Math.round(s*this.dpr);if(i<=0||o<=0){this.cache.delete(e);return}let a=this.cache.get(e),l=!!a&&a.canvas.width>0&&a.canvas.height>0&&Math.abs(a.w-i)<.5&&Math.abs(a.h-o)<.5;if(!(!n&&l)&&!this._capturing.has(e)&&e.tagName!=="CANVAS"){this._capturing.add(e);try{await this._captureWithHtmlToImage(e,i,o,r,s)}finally{this._capturing.delete(e)}}}drawCachedElement(e,n,r,s,i,o){let a=this.cache.get(e);return a?a.canvas.width<=0||a.canvas.height<=0?(this.cache.delete(e),!1):(n.drawImage(a.canvas,r,s,i,o),!0):!1}async captureToCanvas(e,n,r,s=null){if(n<=0||r<=0)return null;let i=s&&s.length?new Set(s):null;try{return await lt(e,{width:n,height:r,pixelRatio:this.dpr,backgroundColor:void 0,fontEmbedCSS:this.fontEmbedCSSForElement(e),filter:i?a=>!i.has(a):void 0,style:{position:"static",top:"auto",left:"auto",right:"auto",bottom:"auto",transform:"none",margin:"0"}})}catch(o){return console.warn("LiquidGlass: captureToCanvas failed for element:",e,o),null}}invalidateCache(e){this.cache.delete(e)}destroy(){this.disposed=!0,this.onCacheUpdate=null,this.cache.clear()}async _captureWithHtmlToImage(e,n,r,s,i){if(!(s<=0||i<=0||n<=0||r<=0))try{let o=await lt(e,{width:s,height:i,pixelRatio:this.dpr,style:{transform:"none",translate:"none",position:"static",margin:"0"},fontEmbedCSS:this.fontEmbedCSSForElement(e)});if(this.disposed)return;this.cache.set(e,{canvas:o,w:n,h:r}),this.onCacheUpdate?.(e)}catch(o){throw o}}};var ut=new WeakMap,dt=class{constructor(e){this.element=e;this.listeners=new Set;this.queued=!1;this.disposed=!1;this.geometry="";this.onResize=()=>{let e=`${this.element.offsetWidth}:${this.element.offsetHeight}:${devicePixelRatio}`;e!==this.geometry&&(this.geometry=e,this.schedule())};this.schedule=()=>{this.disposed||this.timer||(this.timer=setTimeout(()=>{this.timer=void 0,this.refresh().catch(()=>{})},120))};this.refresh=()=>(this.queued=!0,this.pending?this.pending:(this.pending=(async()=>{for(await this.capture.prefetchFontEmbedCSS();this.queued&&!this.disposed;){this.queued=!1;let e=Math.max(1,this.element.offsetWidth),n=Math.max(1,this.element.offsetHeight);this.capture.dpr=Math.min(devicePixelRatio||1,2,16384/e,16384/n,Math.sqrt(16*1024*1024/(e*n))),await this.capture.captureElement(this.element,!0),this.disposed||this.listeners.forEach(r=>r())}})().catch(e=>{throw this.disposed||this.listeners.forEach(n=>n(e)),e}).finally(()=>{this.pending=void 0}),this.pending));this.capture=new Qe(e),this.observer=new MutationObserver(this.schedule),this.observer.observe(e,{subtree:!0,childList:!0,characterData:!0,attributes:!0}),typeof ResizeObserver<"u"&&(this.resize=new ResizeObserver(()=>{let n=`${e.offsetWidth}:${e.offsetHeight}:${devicePixelRatio}`;n!==this.geometry&&(this.geometry=n,this.schedule())}),this.resize.observe(e)),e.addEventListener("load",this.schedule,!0),e.addEventListener("input",this.schedule,!0),e.addEventListener("change",this.schedule,!0),window.addEventListener("resize",this.onResize)}dispose(){this.disposed=!0,this.timer&&clearTimeout(this.timer),this.observer.disconnect(),this.resize?.disconnect(),this.element.removeEventListener("load",this.schedule,!0),this.element.removeEventListener("input",this.schedule,!0),this.element.removeEventListener("change",this.schedule,!0),window.removeEventListener("resize",this.onResize),this.capture.destroy()}};function Qt(t,e){let n=ut.get(t);n||(n=new dt(t),ut.set(t,n)),n.listeners.add(e);let r=n;return{capture:r.capture,refresh:r.refresh,release(){r.listeners.delete(e),r.listeners.size||(r.dispose(),ut.delete(t))}}}function Jt(t){let e=!1;for(let n=t;n;n=n.parentElement){let r=getComputedStyle(n);if(e&&(r.transform!=="none"||r.perspective!=="none"||r.filter!=="none"))return!1;r.position==="fixed"&&(e=!0)}return e}function Zt(t,e,n,r,s){let i=new ze,o=r,a=!0,l=!1,d=0,c=n instanceof HTMLVideoElement?n:void 0,f=c??(n instanceof HTMLCanvasElement?n:void 0),h=!1,p=!1,v=$=>{l||s($)},g=f?void 0:Qt(n,$=>{a=!0,$&&!g?.capture.cache.has(n)&&v("capture-failed")}),y={renderer:i,capture:g?.capture??{cache:new Map},markChanged:()=>{a=!0},destroy:()=>i.destroy()},u=n.getBoundingClientRect(),m=u.top+scrollY,b=Jt(n),_=Jt(t),w=document.createElement("div");w.style.cssText="position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none",w.setAttribute("aria-hidden","true"),document.body.append(w);let q=f?void 0:Mt(y,n,()=>u),z=$t(y,()=>o),F=i.canvas;F.setAttribute("aria-hidden","true"),F.dataset.liquidGlassWebgl="",F.style.cssText=`display:block;position:absolute;left:-${K}px;top:-${K}px;pointer-events:none`,e.append(F);let E=document.createElement("canvas"),T=E.getContext("2d"),Z="",ie=-1,x=()=>{h=!1,v("webgl-unavailable")},S=()=>{a=!0,v("pending")};F.addEventListener("webglcontextlost",x),F.addEventListener("webglcontextrestored",S);let V=()=>{a=!0};c?.addEventListener("seeked",V),c?.addEventListener("loadeddata",V);let re=0,O,I=()=>{re++,l||(O=c.requestVideoFrameCallback(I))};c?.requestVideoFrameCallback&&(O=c.requestVideoFrameCallback(I));let ee=()=>{if(!l&&(d=requestAnimationFrame(ee),!(document.hidden||i.contextLost||p&&!a))){p=!1;try{let $=n.getBoundingClientRect(),ae=t.getBoundingClientRect(),R=scrollY,L=Math.max(0,document.documentElement.scrollHeight-innerHeight),U=R<0||R>L;U||(m=$.top+R),u=new DOMRect($.left,U&&!b?m-R:$.top,$.width,$.height);let D=U&&_?w.getBoundingClientRect().top:0,A=new DOMRect(ae.left,ae.top-D,ae.width,ae.height),Y=t.offsetWidth,J=t.offsetHeight;if(!Y||!J||!u.width||!u.height)return;let C=Math.min(devicePixelRatio||1,3),H=[A.left-u.left,A.top-u.top,u.width,u.height,Y,J,A.width,A.height,C].join(":"),te=O!==void 0?re:c?.currentTime??0;if(!a&&H===Z&&te===ie&&!(f instanceof HTMLCanvasElement)||c&&c.readyState<2)return;let oe=f??g?.capture.cache.get(n)?.canvas;if(!oe)return;let he=Math.round((Y+K*2)*C),me=Math.round((J+K*2)*C);F.style.width=`${Y+K*2}px`,F.style.height=`${J+K*2}px`;let Se=A.width/Y,Te=A.height/J,qe=new DOMRect(A.left,A.top,A.width,A.height),Me=Se===1&&Te===1&&q?.(qe,K);if(!Me&&q&&(Se!==1||Te!==1)&&q(void 0,K),!Me){E.width!==he||E.height!==me?(E.width=he,E.height=me):T.clearRect(0,0,he,me);let xe=(u.left-A.left)/Se*C+K*C,ve=(u.top-A.top)/Te*C+K*C,ne=u.width/Se*C,P=u.height/Te*C;if(f){let k=c?.videoWidth??f.width,G=c?.videoHeight??f.height;if(!k||!G)return;let W=getComputedStyle(n),X=ne,pe=P;if(W.objectFit!=="fill"){let ce=W.objectFit==="cover"?Math.max(ne/k,P/G):W.objectFit==="none"?C:Math.min(ne/k,P/G,W.objectFit==="scale-down"?C:1/0);X=k*ce,pe=G*ce}let le=W.objectPosition.split(" "),He=(ce,We)=>ce.endsWith("%")?parseFloat(ce)/100*We:parseFloat(ce)*C||0;T.save(),T.beginPath(),T.rect(xe,ve,ne,P),T.clip(),T.drawImage(f,xe+He(le[0],ne-X),ve+He(le[1]??"50%",P-pe),X,pe),T.restore()}else T.drawImage(oe,0,ve>0?0:oe.height-1,oe.width,1,xe,0,ne,me),T.drawImage(oe,xe,ve,ne,P)}i.uploadAndBlur(E,0,0,he,me,Math.max(0,o.blur)/5),i.clear(),i.renderGlassPanel({...Tt,cornerRadius:o.radius,shadowOpacity:0},Y,J,C),a=!1,Z=H,ie=te,z.failed?(v("capture-failed"),h=!1):z.ready&&!h&&(h=!0,v("active"))}catch{p=!0,a=!1,h=!1,v("capture-failed")}}};return g&&!g.capture.cache.has(n)&&g.refresh().catch(()=>{}),d=requestAnimationFrame(ee),{update($){o=$,a=!0},async refresh(){await g?.refresh(),a=!0},destroy(){l=!0,cancelAnimationFrame(d),F.removeEventListener("webglcontextlost",x),F.removeEventListener("webglcontextrestored",S),c?.removeEventListener("seeked",V),c?.removeEventListener("loadeddata",V),O!==void 0&&c?.cancelVideoFrameCallback(O),w.remove(),g?.release(),y.destroy(),E.width=0,E.height=0}}}function er(t,e){return!/Android/i.test(t)&&(/iPhone|iPad|iPod/i.test(t)||/Macintosh/i.test(t)&&e>1)}function tr(t,e,n){return e!=="off"&&e!=="blur"&&(n||t==="webgl")}function dn(t){let e=new Map;return{get(n){let r=e.get(n);return r!==void 0&&(e.delete(n),e.set(n,r)),r},set(n,r){if(e.has(n))e.delete(n);else if(e.size>=t){let s=e.keys().next().value;s!==void 0&&e.delete(s)}e.set(n,r)},get size(){return e.size}}}var fn=64,rr=dn(fn),nr=t=>rr.get(t),sr=(t,e)=>rr.set(t,e);var ir={material:{strength:.05,specular:1,depth:.5,curvature:.3,bend:.45,bendWidth:.16,sheen:.32,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:.5,glow:.1},loupe:{strength:.14,specular:1.55,depth:.95,curvature:.5,bend:.4,bendWidth:.07,sheen:1.2,sheenWidth:3.5,sheenFalloff:1.7,sheenAngle:0,glowFalloff:.6,glow:.1},player:{strength:.16,specular:1,depth:.2,curvature:.55,bend:.25,bendWidth:.08,sheen:.95,sheenWidth:2,sheenFalloff:1.5,sheenAngle:50,glowFalloff:1.5,glow:.15},track:{strength:.03,specular:1,depth:.3,curvature:.25,bend:.05,bendWidth:.06,sheen:.35,sheenWidth:3,sheenFalloff:1.5,sheenAngle:45,glowFalloff:1.5,glow:.1}},ar={strength:[0,.5],depth:[0,1],curvature:[0,1],bend:[0,1],bendWidth:[.001,.5],sheen:[0,2],sheenWidth:[0,10],sheenFalloff:[.1,5],sheenAngle:[-360,360],specular:[0,3],glow:[0,1],glowSpread:[.01,2],glowFalloff:[.1,5],brightness:[-1,1]};function ft(t="player",e={}){let n={...ir[t]??ir.player,glowSpread:1,brightness:0};for(let r of Object.keys(ar)){let s=e?.[r];if(typeof s=="number"&&Number.isFinite(s)){let[i,o]=ar[r];n[r]=Math.max(i,Math.min(o,s))}}return n}function or(t,e,n,r="material",s){let{strength:i,specular:o,brightness:a,...l}=ft(r,s),d=`material-v2:${t}:${e}:${n}:${JSON.stringify(l)}`,c=nr(d);if(c)return c;if(typeof document>"u")return"";let f=Ct(512);try{let h=f.generate({lensHalfWidth:t/2,lensHalfHeight:e/2,borderRadius:n,...l,clipToShape:!0,softEdge:!0});return sr(d,h),h}finally{f.dispose()}}function ht(t,e,n){if(typeof n=="number"&&Number.isFinite(n))return Math.max(0,Math.min(.45,n));if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return .06;let r=1.5*.5*t/e;return Math.max(.06,Math.min(.45,r))}function lr(t,e,n){if(!Number.isFinite(t)||t<=0||!Number.isFinite(e)||e<=0)return 1;let s=ht(t,e,n)*e;return Math.max(0,Math.min(1,s/(1.5*.5*t)))}var hn=["classic","convex","shift","rim"];function cr(t){return typeof t=="string"&&hn.includes(t)}function mn(t,e,n,r){let s=Math.max(8,Math.round(t/n/r)*r),i=Math.max(8,Math.round(e/n/r)*r);return{newwidth:s,newheight:i}}function mt(t){let n=((typeof t=="number"&&Number.isFinite(t)?t:0)%360+360)%360;return Math.round(n*1e3)/1e3}function pn(t){let e=t!==0?` gradientTransform="rotate(${t} 0.5 0.5)"`:"";return`          <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"${e}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>`}function gn(t,e,n){let r=t/2,s=e/2,i=Math.max(t,e),o=Math.round(255*t/i),a=Math.round(255*e/i),l=n!==0?` gradientTransform="rotate(${n} ${r} ${s})"`:"";return`          <linearGradient id="red" gradientUnits="userSpaceOnUse" x1="${t}" y1="${s}" x2="0" y2="${s}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(${o},0,0)"/>
          </linearGradient>
          <linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="${r}" y1="0" x2="${r}" y2="${e}"${l}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(0,0,${a})"/>
          </linearGradient>`}var bn=.3,xn=.66,vn=.42,_n=.5;function yn(t,e,n,r,s,i,o){let a=i*t,l=o*e,d=Math.max(8,Math.min(t,e)*xn),c=s>0?Math.min(.5,bn*s):0,f=Math.round((.5+c)*255),h=Math.round((.5-c)*255),p=r!==0?` gradientTransform="rotate(${r} ${a} ${l})"`:"",v=c>0?`<linearGradient id="cvxRed" gradientUnits="userSpaceOnUse" x1="${a-d}" y1="${l}" x2="${a+d}" y2="${l}"${p}><stop offset="0%" stop-color="rgb(${f},0,0)"/><stop offset="100%" stop-color="rgb(${h},0,0)"/></linearGradient>`:'<linearGradient id="cvxRed"><stop offset="0%" stop-color="rgb(128,0,0)"/></linearGradient>',g=c>0?`<linearGradient id="cvxBlue" gradientUnits="userSpaceOnUse" x1="${a}" y1="${l-d}" x2="${a}" y2="${l+d}"${p}><stop offset="0%" stop-color="rgb(0,0,${f})"/><stop offset="100%" stop-color="rgb(0,0,${h})"/></linearGradient>`:'<linearGradient id="cvxBlue"><stop offset="0%" stop-color="rgb(0,0,128)"/></linearGradient>',y=`${v}
          ${g}
          <radialGradient id="cvxEnv" gradientUnits="userSpaceOnUse" cx="${a}" cy="${l}" r="${d}" fx="${a}" fy="${l}"><stop offset="0%" stop-color="#fff"/><stop offset="40%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>
          <mask id="cvxMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#cvxEnv)"/></mask>`,u=`<rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
        <g>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(128,0,0)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxRed)" mask="url(#cvxMask)"/>
        </g>
        <g style="mix-blend-mode: difference">
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="rgb(0,0,128)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${n}" fill="url(#cvxBlue)" mask="url(#cvxMask)"/>
        </g>`;return{defs:y,body:u}}function wn(t,e,n,r,s,i){let o=s*Math.PI/180,a=Math.max(0,Math.min(.5,.5*_n*i)),l=Math.round((.5+a*Math.cos(o))*255),d=Math.round((.5+a*Math.sin(o))*255),c=Math.min(t,e)/2-.5,f=Math.max(1,Math.min(n,c/3)),h=`<mask id="shiftMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="black"/><rect x="${f}" y="${f}" width="${t-f*2}" height="${e-f*2}" rx="${Math.max(0,r-f)}" fill="white" style="filter:blur(${f}px)"/></mask>`,p=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="rgb(${l},0,${d})" mask="url(#shiftMask)"/>`;return{defs:h,body:p}}function En(t,e,n,r,s,i,o,a){let l=o*t,d=a*e,c=Math.min(1,Math.max(0,i)),f=Math.round(127*vn*c),h=Math.min(255,128+f),p=Math.max(0,128-f),v=Math.min(t,e)/2,g=Math.max(n*1.6,Math.min(t,e)*.4),u=(100*Math.max(0,v-g*c)/v).toFixed(2),m=s!==0?` gradientTransform="rotate(${s} ${l} ${d})"`:"",b=`<linearGradient id="rimRed" gradientUnits="userSpaceOnUse" x1="0" y1="${d}" x2="${t}" y2="${d}"${m}><stop offset="0%" stop-color="rgb(${p},0,0)"/><stop offset="50%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(${h},0,0)"/></linearGradient>
          <linearGradient id="rimBlue" gradientUnits="userSpaceOnUse" x1="${l}" y1="0" x2="${l}" y2="${e}"${m}><stop offset="0%" stop-color="rgb(0,0,${p})"/><stop offset="50%" stop-color="rgb(0,0,128)"/><stop offset="100%" stop-color="rgb(0,0,${h})"/></linearGradient>
          <radialGradient id="rimRadial" gradientUnits="userSpaceOnUse" cx="${l}" cy="${d}" r="${v}"${m}><stop offset="0%" stop-color="#000"/><stop offset="${u}%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></radialGradient>
          <mask id="rimMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${t}" height="${e}"><rect x="0" y="0" width="${t}" height="${e}" fill="url(#rimRadial)"/></mask>`,_=`<rect x="0" y="0" width="${t}" height="${e}" fill="rgb(128,0,128)"/>
        <g mask="url(#rimMask)">
          <rect x="0" y="0" width="${t}" height="${e}" fill="black"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimRed)"/>
          <rect x="0" y="0" width="${t}" height="${e}" rx="${r}" fill="url(#rimBlue)" style="mix-blend-mode: screen"/>
        </g>`;return{defs:b,body:_}}function Rn(t){let{width:e,height:n,divisor:r,quantStep:s,radius:i,border:o,lightness:a,alpha:l,displace:d}=t,c=t.blend??"difference",f=mt(t.angle),h=t.shapeAdapt!==!1,p=t.lens??"classic",v=typeof t.lensStrength=="number"&&Number.isFinite(t.lensStrength)?Math.max(0,t.lensStrength):1,g=t.lensCenter?t.lensCenter[0]:.5,y=t.lensCenter?t.lensCenter[1]:.5,{newwidth:u,newheight:m}=mn(e,n,r,s),b=Math.min(u,m)*(o*.5),_=Math.min(i,e/2,n/2)/r;if(p!=="classic"){let F=`<rect x="${b}" y="${b}" width="${u-b*2}" height="${m-b*2}" rx="${_}" fill="hsl(0 0% ${a}% / ${l})" style="filter:blur(${d}px)" />`,E;p==="convex"?E=yn(u,m,_,f,v,g,y):p==="shift"?E=wn(u,m,b,_,f,v):E=En(u,m,b,_,f,v,g,y);let T=p==="rim"?E.body:`${E.body}
        ${F}`;return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${E.defs}
        </defs>
        ${T}
      </svg>
    `}let w=`<rect x="${b}" y="${b}" width="${u-b*2}" height="${m-b*2}" rx="${_}" fill="hsl(0 0% ${a}% / ${l})" style="filter:blur(${d}px)" />`;if(h){let F=gn(u,m,f),E=Math.min(e,n),T=Number.isFinite(t.scale)?t.scale:0,Z=ht(T,E,t.edgeFeather),ie=lr(T,E,t.edgeFeather),x=Math.min(u,m),S=Math.max(.5,Z*x),V=Math.max(0,_-S),re=Math.max(.5,S*.5),O=Math.max(.6,x*.01),I=ie<.999?` opacity="${Math.round(ie*1e3)/1e3}"`:"";return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${F}
          <mask id="clsEnv" maskUnits="userSpaceOnUse" x="0" y="0" width="${u}" height="${m}">
            <rect x="0" y="0" width="${u}" height="${m}" fill="#000"/>
            <rect x="${S}" y="${S}" width="${u-S*2}" height="${m-S*2}" rx="${V}" fill="white" style="filter:blur(${re}px)"/>
          </mask>
        </defs>
        <rect x="0" y="0" width="${u}" height="${m}" fill="rgb(128,128,128)"/>
        <g${I}>
          <g mask="url(#clsEnv)" style="filter:blur(${O}px)">
            <rect x="0" y="0" width="${u}" height="${m}" rx="${_}" fill="url(#red)" />
            <rect x="0" y="0" width="${u}" height="${m}" rx="${_}" fill="url(#blue)" style="mix-blend-mode: ${c}" />
          </g>
        </g>
        ${w}
      </svg>
    `}let q=pn(f),z=Math.max(.6,Math.min(u,m)*.01);return`
      <svg viewBox="0 0 ${u} ${m}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${q}
        </defs>
        <rect x="0" y="0" width="${u}" height="${m}" fill="black"/>
        <g style="filter:blur(${z}px)">
          <rect x="0" y="0" width="${u}" height="${m}" rx="${_}" fill="url(#red)" />
          <rect x="0" y="0" width="${u}" height="${m}" rx="${_}" fill="url(#blue)" style="mix-blend-mode: ${c}" />
        </g>
        ${w}
      </svg>
    `}function ur(t){return`data:image/svg+xml,${encodeURIComponent(Rn(t))}`}var Sn=["ripple","flow","wobble"];function fr(t){return typeof t=="string"&&Sn.includes(t)}var Je={ripple:{baseFrequencyX:.012,baseFrequencyY:.012,numOctaves:2,scale:15,seed:3,ampX:.004,ampY:.004,rateX:1.3,rateY:1.1},flow:{baseFrequencyX:.01,baseFrequencyY:.016,numOctaves:2,scale:18,seed:7,ampX:.006,ampY:0,rateX:.7,rateY:0},wobble:{baseFrequencyX:.006,baseFrequencyY:.006,numOctaves:1,scale:28,seed:11,ampX:.0022,ampY:.0022,rateX:.55,rateY:.5}},dr=t=>Math.round(t*1e4)/1e4;function hr(t,e={}){let n=Je[t]??Je.ripple,r=e.scale!=null&&Number.isFinite(e.scale)?e.scale:n.scale;return e.maxScale!=null&&Number.isFinite(e.maxScale)&&(r=Math.min(r,e.maxScale)),r=Math.max(0,r),{baseFrequencyX:n.baseFrequencyX,baseFrequencyY:n.baseFrequencyY,numOctaves:n.numOctaves,scale:r,seed:n.seed}}function mr(t,e,n=1){let r=Je[t]??Je.ripple,s=(Number.isFinite(e)?e:0)*(Number.isFinite(n)?n:1),i=r.baseFrequencyX+r.ampX*Math.sin(s*r.rateX),o=r.ampY?r.baseFrequencyY+r.ampY*Math.cos(s*r.rateY):r.baseFrequencyY;return[dr(Math.max(1e-4,i)),dr(Math.max(1e-4,o))]}var pr="liquid-glass",Tn=0;function Mn(){if(typeof navigator>"u")return!1;let t=navigator.userAgent||"";return/(iphone|ipad|ipod)/i.test(t)||/firefox|fxios/i.test(t)?!1:/(chrome|chromium|edg|opr)\//i.test(t)}function N(t,e,n){let r=parseFloat(t.getAttribute(e)||"");return Number.isFinite(r)?r:n}var Ln="linear-gradient(135deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.06) 16%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 72%, rgba(255,255,255,0.12) 100%)",An=typeof HTMLElement>"u"?class{}:HTMLElement,Ze=class extends An{static get observedAttributes(){return["renderer","effect-mode","backdrop-selector","backdrop-version","lens-profile","strength","dispersion","radius","frost","blur","saturation","displace","scale","border-color","lightness","alpha","angle","shape-adapt","lens","lens-strength","lens-center","liquid","liquid-speed","liquid-scale"]}filterId=`lg-wc-${++Tn}`;root;ro;resizeFrame=0;liquidRaf=0;webgl;refreshBackdrop(){return this.webgl?.refresh()??Promise.resolve()}constructor(){super(),this.root=this.attachShadow({mode:"open"})}connectedCallback(){this.render(),typeof ResizeObserver<"u"&&(this.ro=new ResizeObserver(()=>{cancelAnimationFrame(this.resizeFrame),this.resizeFrame=requestAnimationFrame(()=>{this.resizeFrame=0,this.isConnected&&this.render()})}),this.ro.observe(this))}disconnectedCallback(){this.webgl?.destroy(),this.webgl=void 0,this.ro?.disconnect(),cancelAnimationFrame(this.resizeFrame),this.liquidRaf&&cancelAnimationFrame(this.liquidRaf)}attributeChangedCallback(){this.isConnected&&this.render()}render(){this.webgl?.destroy(),this.webgl=void 0;let e=N(this,"radius",50),n=N(this,"frost",.1),r=N(this,"blur",0),s=N(this,"saturation",140),i=N(this,"displace",5),o=N(this,"scale",160),a=N(this,"lightness",53),l=N(this,"alpha",.9),d=.05,c=this.getAttribute("border-color")||"rgba(120, 120, 120, 0.7)",f=mt(N(this,"angle",0)),h=this.getAttribute("shape-adapt")!=="false",p=this.getAttribute("lens"),v=cr(p)?p:"classic",g=N(this,"lens-strength",1),y=this.getAttribute("lens-center"),u=(()=>{if(!y)return;let R=y.split(/[ ,]+/).map(parseFloat);return R.length===2&&R.every(Number.isFinite)?[R[0],R[1]]:void 0})(),m=this.getAttribute("liquid"),b=fr(m)?m:null,_=N(this,"liquid-speed",1),w=this.getAttribute("liquid-scale")!=null?N(this,"liquid-scale",NaN):void 0,q=typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches,z=!!b&&!q,F=this.getBoundingClientRect(),E=F.width||300,T=F.height||180,Z=this.getAttribute("renderer"),ie=Z==="webgl"||Z==="svg"?Z:"auto",x=this.getAttribute("effect-mode"),S=x==="blur"||x==="off"||x==="svg"?x:"auto",V=er(navigator.userAgent,navigator.maxTouchPoints||0),re=tr(ie,S,V),O=Mn()&&!re&&S!=="blur"&&S!=="off",I,ee,$="";if(O){let R=ur({width:E,height:T,divisor:3,quantStep:24,radius:e,border:d,lightness:a,alpha:l,displace:i,blend:"difference",angle:f,shapeAdapt:h,lens:v,lensStrength:g,lensCenter:u,scale:o});I=`saturate(${s}%) url(#${this.filterId})`,ee=`hsl(0 0% 100% / ${n})`;let L="",U="";if(z&&b){let D=hr(b,{speed:_,scale:w});L=' result="lqBase"',U=`<feTurbulence type="fractalNoise" baseFrequency="${D.baseFrequencyX} ${D.baseFrequencyY}" numOctaves="${D.numOctaves}" seed="${D.seed}" result="lqNoise" data-lg-turb="1"/><feDisplacementMap in="lqBase" in2="lqNoise" scale="${D.scale}" xChannelSelector="R" yChannelSelector="G"/>`}$=`<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${this.filterId}" color-interpolation-filters="sRGB"><feImage href="${R}" x="0" y="0" width="100%" height="100%" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${o}" xChannelSelector="R" yChannelSelector="B" result="out"/><feGaussianBlur in="out" stdDeviation="${r}"${L}/>${U}</filter></svg>`}else I=`blur(${Math.max(r,9)}px) saturate(${Math.max(s,160)}%) brightness(1.04)`,ee=`${Ln}, hsl(0 0% 100% / ${n})`;if(S==="off"&&(I="none",ee="transparent"),delete this.dataset.glassReason,this.dataset.glassStrategy=S==="off"?"off":O?"svg":"blur",this.root.innerHTML=`
      <style>
        :host { display: block; position: relative; }
        .lg-glass { position: absolute; inset: 0; z-index: 0; border-radius: ${e}px; overflow: hidden;
          background: ${ee}; backdrop-filter: ${I}; -webkit-backdrop-filter: ${I}; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.12); }
        .lg-border { position: absolute; inset: 0; z-index: 2; border-radius: ${e}px; pointer-events: none;

          -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor;
          mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0); mask-composite: exclude; border: 1px solid transparent; }
        .lg-content { position: relative; z-index: 3; width: 100%; height: 100%; }
      </style>
      <div class="lg-glass"></div>
      <div class="lg-border"></div>
      <div class="lg-content"><slot></slot></div>
      ${$}
    `,re){let R=null;try{let L=this.getAttribute("backdrop-selector");L&&(R=document.querySelector(L))}catch{this.dataset.glassReason="invalid-selector"}if(!R||R.contains(this)||this.contains(R))this.dataset.glassReason||=R?"invalid-backdrop":"missing-backdrop";else{let L=document.createElement("div");L.style.cssText=`position:absolute;inset:0;border-radius:${e}px;overflow:hidden;pointer-events:none;visibility:hidden`,L.setAttribute("aria-hidden","true"),this.root.prepend(L);let U=this.getAttribute("lens-profile"),D=U==="material"||U==="loupe"||U==="track"?U:"player",A=ft(D,this.hasAttribute("strength")?{strength:N(this,"strength",.16)}:void 0),Y=this.offsetWidth||E,J=this.offsetHeight||T;try{this.webgl=Zt(this,L,R,{map:or(Y,J,e,D,A),scale:o/160*A.strength*(D==="player"?500:Math.hypot(Y,J)/Math.SQRT2),dispersion:Math.min(1,Math.abs(N(this,"dispersion",50))/50),specular:A.specular,classic:!1,radius:e,blur:r,saturation:s},C=>{let H=C==="active";this.dataset.glassStrategy=H?"webgl":C==="pending"?"pending":"blur",this.dataset.glassReason=H?V?"ios-webgl":"webgl-requested":C,L.style.visibility=H?"visible":"hidden";let te=this.root.querySelector(".lg-glass");te.style.backdropFilter=H?"none":I,te.style.setProperty("-webkit-backdrop-filter",H?"none":I),te.style.background=H?`hsl(0 0% 100% / ${n})`:ee})}catch{this.dataset.glassReason="webgl-unavailable"}}}let ae=this.root.querySelector(".lg-border");if(ae&&(ae.style.background=`linear-gradient(315deg, ${c} 0%, rgba(120,120,120,0) 30%, rgba(120,120,120,0) 70%, ${c} 100%) border-box`),this.liquidRaf&&(cancelAnimationFrame(this.liquidRaf),this.liquidRaf=0),z&&b){let R=this.root.querySelector("[data-lg-turb]");if(R){let L=0,U=D=>{L||(L=D);let[A,Y]=mr(b,(D-L)/1e3,_);R.setAttribute("baseFrequency",`${A} ${Y}`),this.liquidRaf=requestAnimationFrame(U)};this.liquidRaf=requestAnimationFrame(U)}}}};function Fn(t=pr){typeof window>"u"||!window.customElements||customElements.get(t)||customElements.define(t,t===pr?Ze:class extends Ze{})}Fn();})();
/*! Copyright (c) 2026 Sam Asante. MIT; see THIRD_PARTY_NOTICES.md. */

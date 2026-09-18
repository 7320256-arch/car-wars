/* =====================================================================
   renderer.js — Motor de render 3D propio (WebGL2, sin librerías)
   · Instancing real por grupo (misma malla + mismo material)
   · Sol direccional + 16 luces puntuales (faros, farolas, frenos)
   · Shadow map ortográfico 2K con PCF 3x3 y sesgo por pendiente
   · Ambiente hemisférico, reflejo pseudo-entorno, ACES + viñeta
   · Cielo procedural, nubes FBM, niebla exponencial
   · Frustum culling · pases sombra/opaco/aditivo/transparente
   · Partículas instanciadas (humo, chispas, destellos, impactos)
   ===================================================================== */
(function (G) {
  'use strict';
  const M = G.M;
  const FPB = 24;                             /* floats por instancia: model(16)+aMat(4)+aMat2(4) */
  const BYTES = FPB * 4;
  const MAX_MATS = 40, MAX_LIGHTS = 16, MAX_TEX = 12;

  /* ============================== GLSL ============================== */
  const LIB = `
#define MAXL 16
uniform vec4 uFog;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform float uEnvAmt;
uniform float uExposure;
uniform float uTime;
uniform int uUseShadow;
uniform mat4 uLightVP;
uniform vec4 uLightsP[MAXL];
uniform vec4 uLightsC[MAXL];
uniform int uNumLights;
uniform sampler2D uShadow;
uniform float uShadowTexel;
uniform sampler2D uTex[${MAX_TEX}];
float unpackDepth(vec4 c){ return c.r + c.g*(1.0/255.0) + c.b*(1.0/65025.0); }
float sampleShadow(vec4 clip, float ndl){
  vec3 sc = clip.xyz / clip.w * 0.5 + 0.5;
  if (sc.z > 1.0 || sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0) return 1.0;
  float bias = 0.0013 + 0.0075 * (1.0 - ndl);
  vec2 ts = vec2(uShadowTexel);
  float s = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      float d = unpackDepth(texture(uShadow, sc.xy + vec2(float(x), float(y)) * ts));
      s += (sc.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return s / 9.0;
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash12(i), b = hash12(i+vec2(1.0,0.0)), c = hash12(i+vec2(0.0,1.0)), d = hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++){ s += vnoise(p)*a; p = p*2.03 + 11.0; a *= 0.5; }
  return s;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
vec3 finish(vec3 c, float exp){ return pow(aces(c*exp), vec3(1.0/2.2)); }
`;

  const MATS_STRUCT = `
#define MAXM 40
struct Mat {
  vec4 base;   /* rgb albedo, a alpha */
  vec4 emis;   /* rgb emisivo, a pulso */
  vec4 par;    /* rough, metal, texAmount, uvWorld */
  vec4 texA;   /* idxTextura, uvScale.x, uvScale.y, uvOff.x */
  vec4 texB;   /* uvOff.y, idxEmisiva, uvScaleEm.x, uvScaleEm.y */
  vec4 texC;   /* uvOffEm.x, uvOffEm.y, escalaEmisiva, reserved */
};
layout(std140) uniform Mats { Mat uMats[MAXM]; };
uniform int uNumMats;
`;

  const VS_MAIN = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUv;
layout(location=3) in vec4 aI0;
layout(location=4) in vec4 aI1;
layout(location=5) in vec4 aI2;
layout(location=6) in vec4 aI3;
layout(location=7) in vec4 aMat;   /* matIdx, modo, mulAlfa, fasePulso */
layout(location=8) in vec4 aMat2;  /* mulEmisivo, uvMode, uvFactor, reserved */
uniform mat4 uViewProj;
out vec3 vW; out vec3 vN; out vec2 vUv;
flat out float vMatIdx; flat out float vMode; flat out float vAlphaMul; flat out float vPhase; flat out float vEmis;
flat out vec3 vTint;
void main(){
  mat4 m = mat4(aI0,aI1,aI2,aI3);
  /* la 4ª fila de la matriz (m[3],m[7],m[11] en CPU) guarda un tinte por instancia */
  vTint = vec3(aI0.w, aI1.w, aI2.w);
  mat4 t = mat4(vec4(m[0].xyz,0.0), vec4(m[1].xyz,0.0), vec4(m[2].xyz,0.0), m[3]);
  vW = (t * vec4(aPos,1.0)).xyz;
  float s0 = max(dot(t[0].xyz,t[0].xyz), 1e-8);
  float s1 = max(dot(t[1].xyz,t[1].xyz), 1e-8);
  float s2 = max(dot(t[2].xyz,t[2].xyz), 1e-8);
  vN = t[0].xyz*(aNor.x/s0) + t[1].xyz*(aNor.y/s1) + t[2].xyz*(aNor.z/s2);
  /* uvMode: aMat2.y>0.5 → escalar UV por tamaño del objeto (instancias con
     escala no uniforme: fachadas, muros, edificios) */
  vec2 uvS = vec2(1.0);
  if (aMat2.y > 0.5) {
    float sx2 = length(t[0].xyz), sy2 = length(t[1].xyz), sz2 = length(t[2].xyz);
    vec3 an = abs(aNor);
    if (an.y >= max(an.x, an.z)) uvS = vec2(sx2, sz2);
    else if (an.x >= an.z) uvS = vec2(sz2, sy2);
    else uvS = vec2(sx2, sy2);
    vUv = aUv * uvS * max(aMat2.z, 0.001);
  } else vUv = aUv;
  vMatIdx = aMat.x; vMode = aMat.y; vAlphaMul = aMat.z; vPhase = aMat.w; vEmis = aMat2.x;
  gl_Position = uViewProj * vec4(vW,1.0);
}`;

  const FS_MAIN = `#version 300 es
precision highp float; precision highp int;
${MATS_STRUCT}
${LIB}
in vec3 vW; in vec3 vN; in vec2 vUv;
flat in float vMatIdx; flat in float vMode; flat in float vAlphaMul; flat in float vPhase; flat in float vEmis;
flat in vec3 vTint;
out vec4 fragColor;
vec4 sampleTex(int ti, vec2 uv){
  if (ti == 0) return texture(uTex[0], uv);
  if (ti == 1) return texture(uTex[1], uv);
  if (ti == 2) return texture(uTex[2], uv);
  if (ti == 3) return texture(uTex[3], uv);
  if (ti == 4) return texture(uTex[4], uv);
  if (ti == 5) return texture(uTex[5], uv);
  if (ti == 6) return texture(uTex[6], uv);
  if (ti == 7) return texture(uTex[7], uv);
  if (ti == 8) return texture(uTex[8], uv);
  if (ti == 9) return texture(uTex[9], uv);
  if (ti == 10) return texture(uTex[10], uv);
  return texture(uTex[11], uv);
}
void main(){
  int mi = clamp(int(vMatIdx + 0.5), 0, MAXM-1);
  mi = min(mi, max(uNumMats-1, 0));
  Mat mt = uMats[mi];
  int mode = int(vMode + 0.5);
  vec3 alb = mt.base.rgb;
  vec3 emis = mt.emis.rgb * (mt.emis.a > 0.5 ? (0.55 + 0.45*sin(uTime*7.0 + vPhase*6.28)) : 1.0) * vEmis;
  if (max(vTint.x, max(vTint.y, vTint.z)) > 0.02) { alb *= vTint; emis *= vTint; }
  float alpha = mt.base.a * vAlphaMul;
  float rough = clamp(mt.par.x, 0.045, 1.0);
  float metal = clamp(mt.par.y, 0.0, 1.0);
  float texAmt = mt.par.z;
  vec2 uv = (mt.par.w > 0.5) ? vW.xz : vUv;
  if (mt.texA.x >= 0.0){
    vec2 tuv = uv * mt.texA.yz + vec2(mt.texA.w, mt.texB.x);
    vec4 t = sampleTex(int(mt.texA.x + 0.5), tuv);
    alb = mix(alb, alb * t.rgb * 2.0, texAmt);
    rough = clamp(mix(rough, rough * (1.30 - t.a*0.8), texAmt), 0.045, 1.0);
    alpha = mix(alpha, alpha * max(t.a*1.5, 0.03), texAmt*0.7);
  }
  if (mt.texB.y >= 0.0){
    vec2 euv = uv * mt.texB.zw + mt.texC.xy;
    vec4 e = sampleTex(int(mt.texB.y + 0.5), euv);
    emis += e.rgb * mt.texC.z;
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  if (mode == 1 && dot(N,V) > 0.0) N = -N;
  float ndl = max(dot(N, uSunDir), 0.0);
  float sh = (uUseShadow == 1 && mode == 0) ? sampleShadow(uLightVP*vec4(vW,1.0), ndl) : 1.0;
  sh = mix(1.0, sh, 0.88);
  vec3 rad = mix(uGroundAmb, uSkyAmb, N.y*0.5+0.5) * alb * (1.0 - metal*0.5);
  {
    vec3 L = uSunDir;
    float att = ndl * sh;
    vec3 dif = alb*(1.0-metal), spc = mix(vec3(0.04), alb, metal);
    vec3 H = normalize(L+V);
    float nh = max(dot(N,H),0.0), NV = max(dot(N,V),1e-4);
    float a = rough*rough, a2 = a*a;
    float dd = nh*nh*(a2-1.0)+1.0;
    float D = a2/max(3.14159*dd*dd, 1e-7);
    float k = a*0.5;
    float g = (NV/(NV*(1.0-k)+k))*(ndl/(ndl*(1.0-k)+k));
    vec3 F = spc + (1.0-spc)*pow(1.0-nh,5.0);
    rad += uSunCol*att*(dif*0.32 + spc*D*F*g*0.9)*3.0;
  }
  for (int i = 0; i < MAXL; i++){
    if (i >= uNumLights) break;
    vec3 dv = uLightsP[i].xyz - vW;
    float d2 = max(dot(dv,dv), 0.02);
    float d1 = sqrt(d2);
    float att = clamp(1.0 - d1/max(uLightsP[i].w,1e-3), 0.0, 1.0);
    att = att*att/(0.6 + d2*0.05) * uLightsC[i].w;
    if (att < 0.0009) continue;
    vec3 L = dv/d1;
    float nl = max(dot(N,L), 0.0);
    if (nl <= 0.0) continue;
    att *= nl;
    vec3 dif = alb*(1.0-metal), spc = mix(vec3(0.04), alb, metal);
    vec3 H = normalize(L+V);
    float nh = max(dot(N,H),0.0);
    float a = rough*rough, a2 = a*a;
    float dd = nh*nh*(a2-1.0)+1.0;
    float D = a2/max(3.14159*dd*dd, 1e-7);
    vec3 F = spc + (1.0-spc)*pow(1.0-nh,5.0);
    rad += uLightsC[i].rgb*att*(dif*0.34 + spc*D*F*0.55)*3.4;
  }
  vec3 R = reflect(-V, N);
  float fres = pow(1.0-max(dot(N,V),0.0), 5.0);
  float sheen = (1.0-rough)*(1.0-rough);
  vec3 envc = mix(uGroundAmb*0.8, mix(uSkyAmb, vec3(1.0), 0.35), clamp(R.y,0.0,1.0));
  rad += envc*uEnvAmt*sheen*(0.07 + fres*1.35)*mix(vec3(1.0), alb, metal);
  rad += emis;
  float dc = length(uCamPos - vW);
  float f = clamp(1.0 - exp(-uFog.w*dc), 0.0, 1.0);
  vec3 col = mix(rad, uFog.rgb, f*(mode == 2 ? 0.55 : 0.95));
  float A = (mode == 0) ? 1.0 : clamp(alpha, 0.0, 1.0);
  vec3 rgb = finish(col, uExposure);
  if (mode == 2) rgb *= A;
  fragColor = vec4(rgb, A);
}`;

  const VS_SHADOW = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 aI0;
layout(location=4) in vec4 aI1;
layout(location=5) in vec4 aI2;
layout(location=6) in vec4 aI3;
uniform mat4 uViewProj;
void main(){
  mat4 m = mat4(aI0,aI1,aI2,aI3);
  mat4 t = mat4(vec4(m[0].xyz,0.0), vec4(m[1].xyz,0.0), vec4(m[2].xyz,0.0), m[3]);
  gl_Position = uViewProj * (t * vec4(aPos,1.0));
}`;

  const FS_SHADOW = `#version 300 es
precision highp float;
out vec4 fragColor;
void main(){
  float d = clamp(gl_FragCoord.z, 0.0, 1.0);
  float e = d*255.0;
  float r = floor(e)/255.0;
  float g0 = (e - floor(e))*255.0;
  float g = floor(g0)/255.0;
  float b = (g0 - floor(g0))*255.0/255.0;
  fragColor = vec4(r, g, b, 1.0);
}`;

  const VS_FS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
out vec2 vUv;
void main(){ vUv = aCorner; gl_Position = vec4(aCorner*2.0-1.0, 0.9999, 1.0); }`;

  const FS_SKY = `#version 300 es
precision highp float;
${LIB}
in vec2 vUv; out vec4 fragColor;
uniform mat4 uInvVP;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uNadir;
uniform vec3 uSunColSky;
uniform float uStars; uniform float uSunSize; uniform float uSunGlow;
void main(){
  vec4 far = uInvVP * vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz/far.w - uCamPos);
  float y = dir.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.62, clamp(y, 0.0, 1.0)));
  if (y < 0.0) col = mix(uHorizon, uNadir, clamp(-y*3.5, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColSky * pow(sd, mix(60.0, 1500.0, clamp(uSunSize,0.0,1.0))) * 1.4;
  col += uSunColSky * pow(sd, mix(9.0, 190.0, clamp(uSunGlow,0.0,1.0))) * (0.28 + uSunGlow*0.9);
  if (uStars > 0.001 && y > -0.02){
    vec2 g = floor(dir.xz/max(abs(y),0.05)*120.0 + 500.0);
    float h = hash12(g*1.73);
    float tw = 0.65 + 0.35*sin(uTime*2.2 + h*45.0);
    float s = pow(h, 62.0)*16.0*uStars*tw*smoothstep(-0.02,0.28,y);
    col += vec3(s, s, s*1.05);
  }
  vec2 ndc = vUv*2.0-1.0;
  float vig = mix(0.76, 1.0, clamp(1.0-dot(ndc,ndc)*0.2, 0.0, 1.0));
  fragColor = vec4(finish(col*vig, uExposure), 1.0);
}`;

  const FS_CLOUD = `#version 300 es
precision highp float;
${LIB}
in vec2 vUv; out vec4 fragColor;
uniform mat4 uInvVP;
uniform vec3 uZenith; uniform vec3 uHorizon;
uniform float uCloudAmt; uniform float uCloudHi;
void main(){
  if (uCloudAmt <= 0.001){ fragColor = vec4(0.0); return; }
  vec4 far = uInvVP * vec4(vUv*2.0-1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz/far.w - uCamPos);
  if (dir.y < 0.05){ fragColor = vec4(0.0); return; }
  vec2 cp = dir.xz/dir.y*0.035 + vec2(uTime*0.0012, uTime*0.0004);
  float n = fbm(cp*2.0);
  float c = smoothstep(0.58-uCloudAmt*0.26, 0.88, n) * smoothstep(0.05,0.32,dir.y);
  float lit = clamp(0.42 + dot(dir,uSunDir)*0.85, 0.0, 1.5);
  vec3 cc = mix(uHorizon*1.02, vec3(uCloudHi), lit*0.72);
  float a = c*0.85;
  fragColor = vec4(finish(cc, uExposure)*a, a);
}`;

  const VS_PART = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 aP0;
layout(location=2) in vec4 aP1;
layout(location=3) in vec2 aP2;
uniform mat4 uViewProj;
uniform vec3 uRight; uniform vec3 uUp;
out vec2 vQ; flat out vec4 vC; flat out float vKind;
void main(){
  float c = cos(aP2.x), s = sin(aP2.x);
  vec2 q = vec2(aQuad.x*c - aQuad.y*s, aQuad.x*s + aQuad.y*c) * aP0.w;
  vec3 wp = aP0.xyz + uRight*q.x + uUp*q.y;
  vQ = aQuad; vC = aP1; vKind = aP2.y;
  gl_Position = uViewProj * vec4(wp, 1.0);
}`;
  const FS_PART = `#version 300 es
precision highp float;
in vec2 vQ; flat in vec4 vC; flat in float vKind;
out vec4 fragColor;
void main(){
  float r = length(vQ);
  float a;
  if (vKind > 1.5) a = pow(max(1.0 - r, 0.0), 2.2);
  else if (vKind > 0.5) a = pow(max(1.0 - r*1.12, 0.0), 1.5)*0.5;
  else a = smoothstep(1.0, 0.1, r)*0.8;
  float A = a*vC.a;
  if (A < 0.004) discard;
  fragColor = vec4(vC.rgb*A, A);
}`;

  /* =========================== helpers =========================== */
  function compile(gl, type, src, label) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || '';
      console.error('### Shader ' + label + ' ###\n' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + '| ' + l).join('\n'));
      throw new Error('Shader ' + label + ' no compiló: ' + log.split('\n')[0]);
    }
    return s;
  }
  function program(gl, vsSrc, fsSrc, label) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, label + ':vs'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ':fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link ' + label + ': ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { prog: p, u: u };
  }

  let matSeq = 0;
  function Material(o) {
    o = o || {};
    this.id = matSeq++;
    this.name = o.name || ('mat' + this.id);
    this.diffuse = o.color == null ? '#cccccc' : (typeof o.color === 'string' ? o.color : G.rgbCss(o.color));
    this.color = G.toLinear(G.hexToRgb01(o.color == null ? [0.8, 0.8, 0.8] : o.color));
    this.alpha = o.alpha == null ? 1 : o.alpha;
    this.opacity = o.opacity == null ? 1 : o.opacity;
    const e = o.emissive ? G.toLinear(G.hexToRgb01(o.emissive)) : [0, 0, 0];
    const es = o.emissiveScale == null ? (o.emissive ? 1 : 0) : o.emissiveScale;
    this.emissive = [e[0] * es, e[1] * es, e[2] * es];
    this.pulse = !!o.pulse;
    this.roughness = o.roughness == null ? 0.55 : o.roughness;
    this.metalness = o.metalness == null ? 0 : o.metalness;
    this.blend = o.blend || null;                    /* null | 'blend' | 'add' */
    this.texture = o.texture || null;
    this.uvScale = o.uvScale || [1, 1];
    this.uvOffset = o.uvOffset || [0, 0];
    this.emTexture = o.emTexture || null;
    this.emUvScale = o.emUvScale || [1, 1];
    this.emUvOffset = o.emUvOffset || [0, 0];
    this.emScale = o.emScale == null ? 1 : o.emScale;
    this.uvWorld = !!o.uvWorld;
    this.texAmount = o.texAmount == null ? 1 : o.texAmount;
    this.shadow = o.shadow === undefined ? true : !!o.shadow;
  }

  function Mesh(name) {
    this.name = name || 'mesh';
    this.count = 0; this.radius = 1;
    this.groups = []; this.uploaded = false;
  }
  Mesh.prototype.load = function (R, pos, nor, uv, radius) {
    const gl = R.gl, n = pos.length / 3;
    const inter = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      inter[i * 8] = pos[i * 3]; inter[i * 8 + 1] = pos[i * 3 + 1]; inter[i * 8 + 2] = pos[i * 3 + 2];
      inter[i * 8 + 3] = nor[i * 3]; inter[i * 8 + 4] = nor[i * 3 + 1]; inter[i * 8 + 5] = nor[i * 3 + 2];
      inter[i * 8 + 6] = uv ? uv[i * 2] : 0; inter[i * 8 + 7] = uv ? uv[i * 2 + 1] : 0;
    }
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindVertexArray(null);
    this.count = n; this.radius = radius || 1; this.uploaded = true;
    this.renderer = R;
    R.meshes.push(this);
    return this;
  };
  Mesh.prototype.dispose = function () {
    const gl = this.renderer.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    for (const g of this.groups) gl.deleteBuffer(g.instBuf);
    this.groups.length = 0; this.uploaded = false;
    const i = this.renderer.meshes.indexOf(this);
    if (i >= 0) this.renderer.meshes.splice(i, 1);
  };

  function Group(mesh, material) {
    this.mesh = mesh; this.material = material;
    this.data = new Float32Array(0); this.cap = 0; this.count = 0;
    this.bounds = new Float32Array(0);
    this.vis = new Int32Array(0); this.visCount = 0;
    this.compact = new Float32Array(0);
    this.static = false; this.locked = false;
    this.shadow = true; this.mini = false;
    this.dirty = true; this.bufBytes = -1;
    this.tag = '';
  }
  Group.prototype.clear = function () { this.count = 0; this.dirty = true; this.locked = false; this.bufBytes = -1; };
  /* add(matrizModelo, {alpha, emis, uvTile, phase}) */
  /* add(matrizModelo, {alpha, emis, uvTile, phase}) */
  Group.prototype.add = function (m, opt) {
    if (this.locked) return -1;
    const i = this.count++;
    if (i >= this.cap) this.grow(i + 1);
    const f = this.data, b = i * FPB;
    for (let k = 0; k < 16; k++) f[b + k] = m[k];
    const mat = this.material;
    const mode = mat.blend === 'blend' ? 1 : (mat.blend === 'add' ? 2 : 0);
    f[b + 16] = mat.id;
    f[b + 17] = mode;
    f[b + 18] = (opt && opt.alpha != null) ? opt.alpha : 1;
    f[b + 19] = (opt && opt.phase != null) ? opt.phase : 0;
    f[b + 20] = (opt && opt.emis != null) ? opt.emis : 1;
    const uvf = (opt && opt.uvTile) ? 1 / opt.uvTile : 0;
    f[b + 21] = uvf > 0 ? 1 : 0;
    f[b + 22] = uvf > 0 ? uvf : 1;
    f[b + 23] = 0;
    const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
    const r = this.mesh.radius * Math.max(sx, Math.max(sy, sz));
    const bd = this.bounds, bo = i * 4;
    bd[bo] = m[12]; bd[bo + 1] = m[13]; bd[bo + 2] = m[14]; bd[bo + 3] = r;
    this.dirty = true;
    return i;
  };
  Group.prototype.grow = function (need) {
    let cap = Math.max(64, this.cap * 2);
    if (cap < need) cap = need + 16;
    const d = new Float32Array(cap * FPB); d.set(this.data.subarray(0, this.count * FPB)); this.data = d;
    const b = new Float32Array(cap * 4); b.set(this.bounds.subarray(0, this.count * 4)); this.bounds = b;
    this.vis = new Int32Array(cap);
    this.compact = new Float32Array(cap * FPB);
    this.cap = cap; this.bufBytes = -1;
  };
  Group.prototype.replaceAt = function (i, m, keepFlags) {
    const f = this.data, o = i * FPB;
    const n = keepFlags === false ? 20 : 16;
    for (let k = 0; k < n; k++) f[o + k] = m[k];
    this.bounds[i * 4] = m[12]; this.bounds[i * 4 + 1] = m[13]; this.bounds[i * 4 + 2] = m[14];
    this.dirty = true;
  };
  Group.prototype.lock = function () {
    this.locked = true;
    this.data = this.data.subarray(0, this.count * FPB);
    this.bounds = this.bounds.subarray(0, this.count * 4);
  };
  Group.prototype.upload = function (R) {
    const gl = R.gl, n = this.visCount;
    if (!n) return false;
    let src = this.data;
    if (n < this.count) {
      for (let k = 0; k < n; k++) {
        const from = this.vis[k] * FPB, to = k * FPB;
        for (let j = 0; j < FPB; j++) this.compact[to + j] = this.data[from + j];
      }
      src = this.compact;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    const bytes = n * BYTES;
    if (this.bufBytes !== bytes) { gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW); this.bufBytes = bytes; }
    if (this.dirty || n < this.count) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, src, 0, n * FPB); }
    return true;
  };

  /* ========================== Renderer ========================== */
  function Renderer(canvas) {
    this.canvas = canvas;
    const o = { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', premultipliedAlpha: false, preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl2', o);
    if (!gl) throw new Error('NO_WEBGL2');
    this.gl = gl;
    this.meshes = []; this.materials = []; this.lights = [];
    this.dprCap = 1.3;
    this.quality = { shadows: true, shadowSize: 2048, clouds: true, particles: 1 };
    this.env = {
      sun: [-0.42, 0.55, -0.72], sunCol: [1, 0.95, 0.86], sunPower: 1,
      sky: [0.42, 0.56, 0.82], ground: [0.3, 0.28, 0.26], ambInt: 1,
      fog: [0.72, 0.8, 0.9], fogD: 0.0022,
      zenith: [0.13, 0.32, 0.72], horizon: [0.79, 0.86, 0.95], nadir: [0.34, 0.35, 0.38],
      sunColSky: [1, 0.95, 0.85], stars: 0, sunSize: 0.3, sunGlow: 0.4,
      exposure: 1.0, envAmt: 1, cloudAmt: 0.45, cloudHi: 0.98
    };
    this.stats = { draws: 0, tris: 0, inst: 0 };
    this.time = 0;
    this.shadowCenter = null;
    this.shadowSpan = 150;
    this._tmp = { m: M.m4() };
    this.init();
  }

  Renderer.prototype.init = function () {
    const gl = this.gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    const an = gl.getExtension('EXT_texture_filter_anisotropic');
    if (an) this.maxAniso = gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    this.anisoExt = an;

    this.pMain = program(gl, VS_MAIN, FS_MAIN, 'main');
    this.pShadow = program(gl, VS_SHADOW, FS_SHADOW, 'shadow');
    this.pSky = program(gl, VS_FS, FS_SKY, 'sky');
    this.pCloud = program(gl, VS_FS, FS_CLOUD, 'cloud');
    this.pPart = program(gl, VS_PART, FS_PART, 'particle');

    this.matArr = new Float32Array(MAX_MATS * 24);   /* 6 vec4 por material */
    this.matBuf = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.matBuf);
    gl.bufferData(gl.UNIFORM_BUFFER, this.matArr.byteLength, gl.DYNAMIC_DRAW);
    const bi = gl.getUniformBlockIndex(this.pMain.prog, 'Mats');
    if (bi !== 0xffffffff) gl.uniformBlockBinding(this.pMain.prog, bi, 0);
    else throw new Error('No se encontró el bloque de materiales (Mats)');
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    this.fsVao = gl.createVertexArray();
    gl.bindVertexArray(this.fsVao);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 2, 0, 0, 2]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.slots = new Array(MAX_TEX).fill(null);
    this.slotIdx = new Map();
    this.whiteTex = this.makeSolid(255, 255, 255, 255);
    this.setShadowSize(this.quality.shadowSize);

    /* partículas */
    this.pCap = 2400;
    this.pData = new Float32Array(this.pCap * 10);
    this.pCount = 0;
    this.pVao = gl.createVertexArray();
    gl.bindVertexArray(this.pVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.pInst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pInst);
    gl.bufferData(gl.ARRAY_BUFFER, this.pData.byteLength, gl.DYNAMIC_DRAW);
    const S = 40;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, S, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, S, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, S, 32); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.clearColor(0.5, 0.62, 0.78, 1);
  };

  Renderer.prototype.setShadowSize = function (n) {
    const gl = this.gl;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFbo); this.shadowTex = null; }
    this.shadowSize = n || 0;
    if (!n) return;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO sombra incompleto:', st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.shadowTex = t; this.shadowFbo = f;
  };
  Renderer.prototype.makeSolid = function (r, g, b, a) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  };
  Renderer.prototype.addMaterial = function (m) {
    if (!(m instanceof Material)) m = new Material(m);
    if (m.id >= MAX_MATS) { m.id = MAX_MATS - 1; console.warn('Máximo de materiales alcanzado:', m.name); }
    this.materials[m.id] = m;
    if (m.texture) this.addTexture(m.texture);
    if (m.emTexture) this.addTexture(m.emTexture);
    return m;
  };
  Renderer.prototype.addTexture = function (t) {
    if (!t) return -1;
    if (this.slotIdx.has(t)) return this.slotIdx.get(t);
    const i = this.slots.findIndex(s => !s);
    if (i < 0) { console.warn('Sin slots de textura libres:', t.name); return -1; }
    const gl = this.gl;
    if (!t.gl) t.gl = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t.gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = t.wrap === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.anisoExt) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, this.maxAniso || 1));
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.slots[i] = t; this.slotIdx.set(t, i);
    return i;
  };
  Renderer.prototype.freeTextures = function () {
    const gl = this.gl;
    for (let i = 0; i < MAX_TEX; i++) {
      const t = this.slots[i];
      if (t) { if (t.gl) gl.deleteTexture(t.gl); t.gl = null; this.slotIdx.delete(t); this.slots[i] = null; }
    }
  };
  /* entorno: acepta hex string o [r,g,b]; normaliza la dirección solar */
  Renderer.prototype.setEnv = function (o) {
    const e = this.env;
    if (!o) return e;
    for (const k in o) {
      const v = o[k];
      if (typeof v === 'string') e[k] = G.hexToRgb01(v);
      else if (Array.isArray(v) || (v && v.length)) e[k] = v.slice ? v.slice() : v;
      else e[k] = v;
    }
    if (e.sun) { const l = Math.hypot(e.sun[0], e.sun[1], e.sun[2]) || 1; e.sun = [e.sun[0] / l, e.sun[1] / l, e.sun[2] / l]; }
    this._envVer = (this._envVer || 0) + 1;
    return e;
  };

  Renderer.prototype.group = function (mesh, material) {
    const g = new Group(mesh, material);
    g.instBuf = this.gl.createBuffer();
    g.shadow = material.shadow !== false && !!mesh.radius;
    mesh.groups.push(g);
    return g;
  };

  Renderer.prototype.setView = function (view, proj, camPos) {
    this.view = view; this.proj = proj; this.camPos = camPos;
    if (!this.vp) { this.vp = M.m4(); this.ivp = M.m4(); }
    M.multiply(this.vp, proj, view);
    M.invert(this.ivp, this.vp);
  };

  Renderer.prototype.extractPlanes = function () {
    const vp = this.vp;
    if (!this._planes) this._planes = new Float32Array(24);
    const pl = this._planes;
    for (let i = 0; i < 3; i++) {
      for (let s = 0; s < 2; s++) {
        const sg = s ? -1 : 1, idx = i * 2 + s;
        let a = vp[3] + sg * vp[i], b = vp[7] + sg * vp[4 + i], c = vp[11] + sg * vp[8 + i], d = vp[15] + sg * vp[12 + i];
        const l = Math.hypot(a, b, c) || 1;
        pl[idx * 4] = a / l; pl[idx * 4 + 1] = b / l; pl[idx * 4 + 2] = c / l; pl[idx * 4 + 3] = d / l;
      }
    }
  };

  Renderer.prototype.cull = function (mini) {
    const pl = this._planes;
    let total = 0;
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const gs = this.meshes[mi].groups;
      for (let gi = 0; gi < gs.length; gi++) {
        const g = gs[gi];
        if (mini && !g.mini) { g.visCount = 0; continue; }
        const b = g.bounds, n = g.count;
        let k = 0;
        if (pl) {
          for (let i = 0; i < n; i++) {
            const o = i * 4;
            let vis = true;
            for (let p = 0; p < 6; p++) {
              const q = p * 4;
              if (pl[q] * b[o] + pl[q + 1] * b[o + 1] + pl[q + 2] * b[o + 2] + pl[q + 3] < -b[o + 3]) { vis = false; break; }
            }
            if (vis) g.vis[k++] = i;
          }
        } else { for (let i = 0; i < n; i++) g.vis[k++] = i; }
        g.visCount = k; total += k;
      }
    }
    this.stats.inst = total;
    return total;
  };

  Renderer.prototype.drawGroups = function (mode, shadowPass) {
    const gl = this.gl;
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const mesh = this.meshes[mi];
      if (!mesh.uploaded) continue;
      const gs = mesh.groups;
      for (let gi = 0; gi < gs.length; gi++) {
        const g = gs[gi];
        if (!g.visCount) continue;
        if (shadowPass && (!g.shadow || g.static && g.shadowStaticOff)) continue;
        const blend = g.material.blend;
        if (mode === 0 && blend) continue;
        if (mode === 1 && blend !== 'blend') continue;
        if (!g.upload(this)) continue;
        gl.bindVertexArray(mesh.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.instBuf);
        for (let a = 0; a < 6; a++) {
          gl.enableVertexAttribArray(3 + a);
          gl.vertexAttribPointer(3 + a, 4, gl.FLOAT, false, BYTES, a * 16);
          gl.vertexAttribDivisor(3 + a, 1);
        }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, g.visCount);
        this.stats.draws++;
        if (!shadowPass) this.stats.tris += (mesh.count / 3) * g.visCount;
      }
    }
    gl.bindVertexArray(null);
  };

  Renderer.prototype.renderShadowPass = function () {
    const gl = this.gl;
    this.shadowOn = false;
    if (!this.quality.shadows || !this.shadowTex) return;
    const c = this.shadowCenter || this.camPos;
    const sun = M.norm(this.env.sun);
    const ext = this.shadowSpan;
    const t = Math.max(c[1], 0) / Math.max(sun[1], 0.14);
    let cx = c[0] - sun[0] * t, cz = c[2] - sun[2] * t;
    const texel = 2 * ext / this.shadowSize;
    cx = Math.round(cx / texel) * texel; cz = Math.round(cz / texel) * texel;
    if (!this._lv) { this._lv = M.m4(); this._lp = M.m4(); this.lightVP = M.m4(); }
    M.ortho(this._lp, -ext, ext, -ext, ext, 8, 760);
    M.lookAt(this._lv, [cx + sun[0] * 320, sun[1] * 320, cz + sun[2] * 320], [cx, 0, cz], [0, 1, 0]);
    M.multiply(this.lightVP, this._lp, this._lv);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.pShadow.prog);
    gl.uniformMatrix4fv(this.pShadow.u.uViewProj, false, this.lightVP);
    gl.cullFace(gl.FRONT);
    this.drawGroups(0, true);
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowOn = true;
  };

  Renderer.prototype.render = function (dt) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    this.w = w; this.h = h;
    this.stats.draws = 0; this.stats.tris = 0;
    this.time += dt;

    this.extractPlanes();
    this.cull(false);
    this.renderShadowPass();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.drawSky();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);

    /* -------- uniforms del programa principal -------- */
    const pm = this.pMain, u = pm.u, e = this.env;
    gl.useProgram(pm.prog);
    const sun = M.norm(e.sun);
    gl.uniformMatrix4fv(u.uViewProj, false, this.vp);
    gl.uniformMatrix4fv(u.uLightVP, false, this.shadowOn ? this.lightVP : new Float32Array(16));
    gl.uniform1i(u.uUseShadow, this.shadowOn ? 1 : 0);
    gl.uniform3fv(u.uCamPos, this.camPos);
    gl.uniform3fv(u.uSunDir, sun);
    gl.uniform3fv(u.uSunCol, G.scaleLin(G.hexToRgb01(e.sunCol), e.sunPower * 0.34));
    gl.uniform3fv(u.uSkyAmb, G.scaleLin(G.hexToRgb01(e.sky), e.ambInt * 0.5));
    gl.uniform3fv(u.uGroundAmb, G.scaleLin(G.hexToRgb01(e.ground), e.ambInt * 0.32));
    gl.uniform1f(u.uEnvAmt, e.envAmt);
    gl.uniform1f(u.uExposure, e.exposure);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform1i(u.uNumMats, Math.max(this.materials.length, 1));
    gl.uniform4f(u.uFog, e.fog[0], e.fog[1], e.fog[2], e.fogD);
    let lu = this._lu;
    if (!lu) { lu = this._lu = { p: new Float32Array(MAX_LIGHTS * 4), c: new Float32Array(MAX_LIGHTS * 4) }; }
    const nl = Math.min(this.lights.length, MAX_LIGHTS);
    for (let i = 0; i < nl; i++) {
      const L = this.lights[i];
      lu.p[i * 4] = L[0]; lu.p[i * 4 + 1] = L[1]; lu.p[i * 4 + 2] = L[2]; lu.p[i * 4 + 3] = L[6] == null ? 24 : L[6];
      lu.c[i * 4] = L[3]; lu.c[i * 4 + 1] = L[4]; lu.c[i * 4 + 2] = L[5]; lu.c[i * 4 + 3] = L[7] == null ? 1 : L[7];
    }
    gl.uniform4fv(u.uLightsP, lu.p);
    gl.uniform4fv(u.uLightsC, lu.c);
    gl.uniform1i(u.uNumLights, nl);
    gl.uniform1f(u.uShadowTexel, 1 / Math.max(256, this.shadowSize || 1024));

    /* texturas: unidades 0..MAX_TEX-1 = uTex, la siguiente = mapa de sombras */
    for (let i = 0; i < MAX_TEX; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.slots[i] ? this.slots[i].gl : this.whiteTex);
    }
    gl.activeTexture(gl.TEXTURE0 + MAX_TEX);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex || this.whiteTex);
    gl.uniform1i(u.uShadow, MAX_TEX);
    for (let i = 0; i < MAX_TEX; i++) gl.uniform1i(gl.getUniformLocation(pm.prog, 'uTex[' + i + ']'), i);
    gl.activeTexture(gl.TEXTURE0);

    /* -------- materiales a UBO -------- */
    const ma = this.matArr;
    for (let i = 0; i < MAX_MATS; i++) {
      const m = this.materials[i], o = i * 24;
      if (!m) {
        ma[o] = 1; ma[o + 1] = 1; ma[o + 2] = 1; ma[o + 3] = 1;
        ma[o + 4] = 0; ma[o + 5] = 0; ma[o + 6] = 0; ma[o + 7] = 0;
        ma[o + 8] = 0.6; ma[o + 9] = 0; ma[o + 10] = 0; ma[o + 11] = 0;
        ma[o + 12] = -1; ma[o + 13] = 1; ma[o + 14] = 1; ma[o + 15] = 0;
        ma[o + 16] = 0; ma[o + 17] = -1; ma[o + 18] = 1; ma[o + 19] = 1;
        ma[o + 20] = 0; ma[o + 21] = 0; ma[o + 22] = 0; ma[o + 23] = 0;
        continue;
      }
      ma[o] = m.color[0]; ma[o + 1] = m.color[1]; ma[o + 2] = m.color[2]; ma[o + 3] = m.opacity * m.alpha;
      ma[o + 4] = m.emissive[0]; ma[o + 5] = m.emissive[1]; ma[o + 6] = m.emissive[2]; ma[o + 7] = m.pulse ? 1 : 0;
      ma[o + 8] = m.roughness; ma[o + 9] = m.metalness; ma[o + 10] = m.texAmount; ma[o + 11] = m.uvWorld ? 1 : 0;
      const ti = m.texture ? this.slotIdx.get(m.texture) : null;
      ma[o + 12] = (ti == null || ti < 0) ? -1 : ti;
      ma[o + 13] = m.uvScale[0]; ma[o + 14] = m.uvScale[1]; ma[o + 15] = m.uvOffset[0];
      ma[o + 16] = m.uvOffset[1];
      const ei = m.emTexture ? this.slotIdx.get(m.emTexture) : null;
      ma[o + 17] = (ei == null || ei < 0) ? -1 : ei;
      ma[o + 18] = m.emUvScale[0]; ma[o + 19] = m.emUvScale[1];
      ma[o + 20] = m.emUvOffset[0]; ma[o + 21] = m.emUvOffset[1];
      ma[o + 22] = m.emScale; ma[o + 23] = 0;
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.matBuf);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, ma);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.matBuf);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    this.drawGroups(0, false);
    this.drawParticles();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this.drawGroups(1, false);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  /* colores del cielo cacheados (sin asignaciones por frame) */
  Renderer.prototype.skyColors = function () {
    const e = this.env, v = this._envVer || 0;
    if (this._skyCacheV === v && this._skyCache) return this._skyCache;
    const c = this._skyCache || (this._skyCache = {
      zenith: new Float32Array(3), horizon: new Float32Array(3), nadir: new Float32Array(3), sunCol: new Float32Array(3)
    });
    const put = (k, arr, sc) => {
      const a = G.hexToRgb01(e[k] || '#888888');
      arr[0] = a[0] * sc; arr[1] = a[1] * sc; arr[2] = a[2] * sc;
    };
    put('zenith', c.zenith, 1); put('horizon', c.horizon, 1); put('nadir', c.nadir, 1); put('sunColSky', c.sunCol, 1.6);
    this._skyCacheV = v;
    return c;
  };

  Renderer.prototype.drawSky = function () {
    const gl = this.gl, e = this.env, p = this.pSky;
    const c = this.skyColors();
    gl.bindVertexArray(this.fsVao);
    gl.useProgram(p.prog);
    const sun = M.norm(e.sun);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.vp);
    gl.uniformMatrix4fv(p.u.uInvVP, false, this.ivp);
    gl.uniform3fv(p.u.uCamPos, this.camPos);
    gl.uniform3fv(p.u.uSunDir, sun);
    gl.uniform3fv(p.u.uZenith, c.zenith);
    gl.uniform3fv(p.u.uHorizon, c.horizon);
    gl.uniform3fv(p.u.uNadir, c.nadir);
    gl.uniform3fv(p.u.uSunColSky, c.sunCol);
    gl.uniform1f(p.u.uStars, e.stars);
    gl.uniform1f(p.u.uSunSize, e.sunSize);
    gl.uniform1f(p.u.uSunGlow, e.sunGlow);
    gl.uniform1f(p.u.uExposure, e.exposure);
    gl.uniform1f(p.u.uTime, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.draws++;
    if (this.quality.clouds && e.cloudAmt > 0.001) {
      const pc = this.pCloud;
      gl.useProgram(pc.prog);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(pc.u.uViewProj, false, this.vp);
      gl.uniformMatrix4fv(pc.u.uInvVP, false, this.ivp);
      gl.uniform3fv(pc.u.uCamPos, this.camPos);
      gl.uniform3fv(pc.u.uSunDir, sun);
      gl.uniform3fv(pc.u.uZenith, c.zenith);
      gl.uniform3fv(pc.u.uHorizon, c.horizon);
      gl.uniform1f(pc.u.uCloudAmt, e.cloudAmt);
      gl.uniform1f(pc.u.uCloudHi, e.cloudHi);
      gl.uniform1f(pc.u.uExposure, e.exposure);
      gl.uniform1f(pc.u.uTime, this.time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      this.stats.draws++;
    }
    gl.bindVertexArray(null);
  };

  /* -------- partículas -------- */
  Renderer.prototype.beginParticles = function () { this.pCount = 0; };
  Renderer.prototype.pushParticle = function (x, y, z, size, r, g, b, a, roll, kind) {
    if (this.pCount >= this.pCap) return;
    const o = this.pCount++ * 10, d = this.pData;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    d[o + 8] = roll; d[o + 9] = kind;
  };
  Renderer.prototype.drawParticles = function () {
    if (!this.pCount || this.quality.particles <= 0) return;
    const gl = this.gl, p = this.pPart;
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.pVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pInst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pData, 0, this.pCount * 10);
    const v = this.view;
    gl.uniform3f(p.u.uRight, v[0], v[4], v[8]);
    gl.uniform3f(p.u.uUp, v[1], v[5], v[9]);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.vp);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.pCount);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.stats.draws++;
    gl.bindVertexArray(null);
    gl.useProgram(this.pMain.prog);
  };

  Renderer.prototype.clearFramebuffers = function () {
    const gl = this.gl;
    for (const mesh of this.meshes) {
      for (const g of mesh.groups) if (g.instBuf) { gl.deleteBuffer(g.instBuf); g.bufBytes = -1; }
    }
  };

  Renderer.prototype.resetMaterials = function () {
    this.materials.length = 0;
    matSeq = 0;
    this.freeTextures();
  };
  G.resetMaterials = function () { matSeq = 0; };
  G.Material = Material;
  G.Mesh = Mesh;
  G.Group = Group;
  G.Renderer = Renderer;
  G.MAX_MATS = MAX_MATS;
  G.MAX_LIGHTS = MAX_LIGHTS;
  G.SHADERS = { VS_MAIN, FS_MAIN, LIB, MATS_STRUCT, VS_SHADOW, FS_SHADOW, VS_FS, FS_SKY, FS_CLOUD, VS_PART, FS_PART };
  G.toGLSL = function (vs, fs) { return { vs: vs, fs: fs }; };
})(window.CW);

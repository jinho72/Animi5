import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.js";

/* --- 1. GLOBAL STATE & CONFIG --- */
const musicTracks = [
  "https://raw.githubusercontent.com/jinho72/Animi/bb2abe03a1617f20c3ca1579a15dde94130b5ad2/meditation-music-338902.mp3",
  "https://raw.githubusercontent.com/jinho72/Animi/bb2abe03a1617f20c3ca1579a15dde94130b5ad2/meditation-background-409198.mp3"
];

const modes = {
  balance: { name: "Balance", inhale: 4, hold: 4, exhale: 4 },
  calm:    { name: "Calm",    inhale: 4, hold: 7, exhale: 8 },
  energize:{ name: "Energize",inhale: 4, hold: 4, exhale: 2 }
};

let els = {};
let state = {
  isBreathing: false,
  breathPhase: "idle", 
  cycleCount: 0,
  selectedMode: "balance",
  musicOn: false,
  hasFace: false,
  phaseStartTime: 0 
};

let breathTimeout = null;
let audioCtx, analyser, analyserData;
let orbVizRunning = false;

let headAnchor = new THREE.Vector3(0, 0, 0); 
let faceLandmarker = null;
let faceDetector = null;
let canvasCtx;
let scene, camera, renderer, lotusGroup, petalMeshes = [], headOccluder;
let lastVideoTime = -1;

/* --- 2. INITIALIZATION --- */
window.addEventListener('DOMContentLoaded', () => {
  els = {
    lotusContainer: document.getElementById("lotusContainer"),
    webcam: document.getElementById("webcam"),
    canvas: document.getElementById("output_canvas"),
    instruction: document.getElementById("instructionText"),
    cycle: document.getElementById("cycleText"),
    faceStatus: document.getElementById("faceStatus"),
    bgMusic: document.getElementById("bgMusic"),
    controls: document.querySelector(".controls"), // ADDED: Controls container
    btns: {
      breath: document.getElementById("breathToggleBtn"),
      modes: document.getElementById("settingsToggleBtn"),
      camera: document.getElementById("cameraBtn"),
      music: document.getElementById("musicBtn"),
      modeContainer: document.getElementById("modeButtons")
    },
    orbs: {
      purple: document.getElementById("orbPurple"),
      blue: document.getElementById("orbBlue"),
      pink: document.getElementById("orbPink")
    }
  };

  initThree();
  setupEventListeners();
  updateInstructionUI(); 
});

function setupEventListeners() {
  els.btns.breath.addEventListener("click", toggleBreathing);
  
  // MODIFIED: Toggle visibility of the main controls panel
  els.btns.modes.addEventListener("click", () => {
    els.controls.classList.toggle("visible");
    els.btns.modeContainer.classList.toggle("hidden");
  });
  
  els.btns.camera.addEventListener("click", enableCamera);
  els.btns.music.addEventListener("click", toggleMusic);

  const modeBtns = document.querySelectorAll(".mode-btn");
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (!mode) return;
      state.selectedMode = mode;
      modeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if (state.isBreathing) restartBreathing();
    });
  });
}

/* --- 3. BREATHING LOGIC --- */
function toggleBreathing() {
  state.isBreathing = !state.isBreathing;
  if (state.isBreathing) {
    state.cycleCount = 0;
    els.btns.breath.textContent = "⏸ Pause";
    els.btns.breath.classList.add("primary");
    startMusic(); 
    runBreathSequence();
  } else {
    els.btns.breath.textContent = "▶ Start Breathing";
    els.btns.breath.classList.remove("primary");
    stopBreathSequence();
    stopMusic();
  }
}

function restartBreathing() {
  stopBreathSequence();
  runBreathSequence();
}

function stopBreathSequence() {
  clearTimeout(breathTimeout);
  state.breathPhase = "idle";
  updateInstructionUI();
}

function runBreathSequence() {
  if (!state.isBreathing) return;
  const mode = modes[state.selectedMode];
  const phases = [
    { name: "inhale", dur: mode.inhale * 1000 },
    { name: "hold",   dur: mode.hold * 1000 },
    { name: "exhale", dur: mode.exhale * 1000 },
    { name: "rest",   dur: 1000 }
  ];

  let phaseIndex = 0;
  function nextPhase() {
    if (!state.isBreathing) return;
    const p = phases[phaseIndex];
    state.breathPhase = p.name;
    state.phaseStartTime = performance.now();
    updateInstructionUI();

    breathTimeout = setTimeout(() => {
      phaseIndex++;
      if (phaseIndex >= phases.length) {
        phaseIndex = 0;
        state.cycleCount++;
        updateInstructionUI();
      }
      nextPhase();
    }, p.dur);
  }
  nextPhase();
}

function updateInstructionUI() {
  const map = { inhale: "Breathe In", hold: "Hold", exhale: "Breathe Out", rest: "Rest", idle: "Ready" };
  if(els.instruction) els.instruction.textContent = map[state.breathPhase];
  if(els.cycle) els.cycle.textContent = state.cycleCount > 0 ? `${state.cycleCount} cycles` : "";
}

/* --- 4. THREE.JS & ANIMATION --- */
function initThree() {
  if (!els.lotusContainer) return;
  const width = els.lotusContainer.clientWidth || window.innerWidth;
  const height = els.lotusContainer.clientHeight || window.innerHeight;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 2, 8);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);
  const mainLight = new THREE.DirectionalLight(0xffffff, 1.5);
  mainLight.position.set(0, 10, 5);
  scene.add(mainLight);
  
  // Teal/Cyan Lights for that "Glassy" look
  const blueLight = new THREE.PointLight(0x00e5ff, 3.0, 50);
  blueLight.position.set(-8, 2, 5);
  scene.add(blueLight);
  const cyanLight = new THREE.PointLight(0x1de9b6, 3.0, 50);
  cyanLight.position.set(8, -2, 5);
  scene.add(cyanLight);

  createLotusPetals();
  createHeadOccluder();

  els.lotusContainer.appendChild(renderer.domElement);
  window.addEventListener("resize", onWindowResize);
  animate();
}

function onWindowResize() {
  if (!els.lotusContainer || !camera || !renderer) return;
  const width = els.lotusContainer.clientWidth || window.innerWidth;
  const height = els.lotusContainer.clientHeight || window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function createLotusPetals() {
  lotusGroup = new THREE.Group();
  scene.add(lotusGroup);
  petalMeshes = [];

  // MATERIAL UPDATE: Teal Glass
  const petalMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x00838f,        // Dark Teal Base
    emissive: 0x004d40,     // Slight inner glow
    emissiveIntensity: 0.2,
    metalness: 0.1, 
    roughness: 0.05,        // Very smooth
    transmission: 0.98,     // High transparency
    thickness: 1.5,
    ior: 1.4,               // Glass-like refraction
    clearcoat: 1.0,
    attenuationColor: new THREE.Color(0xe0f2f1), // Light cyan absortion
    attenuationDistance: 1.5, 
    side: THREE.DoubleSide,
    transparent: true
  });

  const petalCount = 14; // More petals for elaborate look
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const petalShape = new THREE.Shape();
    petalShape.moveTo(0, 0);
    // Elongated elegant petal shape
    petalShape.bezierCurveTo(0.5, 1.0, 0.7, 2.0, 0, 3.2);
    petalShape.bezierCurveTo(-0.7, 2.0, -0.5, 1.0, 0, 0);

    const extrudeSettings = { steps: 2, depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 };
    const geometry = new THREE.ExtrudeGeometry(petalShape, extrudeSettings);
    geometry.translate(0, 0, 0); 

    const petal = new THREE.Mesh(geometry, petalMaterial.clone());
    petal.position.y = 0;
    // initial rotation set in animation loop
    lotusGroup.add(petal);
    petalMeshes.push(petal);
  }
}

function createHeadOccluder() {
  const geometry = new THREE.SphereGeometry(1, 32, 32);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, colorWrite: false });
  headOccluder = new THREE.Mesh(geometry, material);
  headOccluder.renderOrder = 0;
  headOccluder.visible = false; 
  scene.add(headOccluder);
}

function animate() {
  requestAnimationFrame(animate);
  // Very slow rotation of the whole flower
  if(lotusGroup) lotusGroup.rotation.y += 0.0005; 
  updatePetalsByBreath();
  if(renderer && scene && camera) renderer.render(scene, camera);
}

// --- FIX 1: ELABORATE "CORKSCREW" SWIRL ANIMATION ---
function updatePetalsByBreath() {
  if (!petalMeshes.length) return;

  const now = performance.now();
  const elapsed = now - state.phaseStartTime;
  const mode = modes[state.selectedMode];
  let duration = 1000;

  if (state.breathPhase === "inhale") duration = mode.inhale * 1000;
  else if (state.breathPhase === "hold") duration = mode.hold * 1000;
  else if (state.breathPhase === "exhale") duration = mode.exhale * 1000;

  const rawProgress = Math.min(elapsed / duration, 1);
  const eased = rawProgress < 0.5 
    ? 2 * rawProgress * rawProgress 
    : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;

  const flowTime = now * 0.0005; 
  const anchor = state.hasFace ? headAnchor : new THREE.Vector3(0, 1.0, 0);

  petalMeshes.forEach((petal, i) => {
    const count = petalMeshes.length;
    // Base radial angle
    const baseAngle = (i / count) * Math.PI * 2;
    
    // Config values
    const closedRadius = 0.2; // TIGHT bud
    const openRadius = 3.0;
    
    // Tilt (X Axis): 90deg (1.57) is vertical/closed. 0.2 is flat/open.
    const closedTilt = Math.PI * 0.5; 
    const openTilt = 0.2; 

    // Swirl (Y Axis): How much they spiral around the center
    const swirlAmount = Math.PI * 0.8; // Almost a full half-turn

    let currentRadius, currentTilt, currentSwirlOffset;

    if (state.breathPhase === "inhale") {
      // OPENING: Uncorkscrew
      // Radius expands
      currentRadius = closedRadius + (eased * (openRadius - closedRadius));
      // Tilt drops down
      currentTilt = closedTilt - (eased * (closedTilt - openTilt));
      // Swirl unwinds (add rotation based on progress)
      currentSwirlOffset = (1 - eased) * swirlAmount;
    } 
    else if (state.breathPhase === "hold") {
      // HOVERING: Breathing slightly
      const breathe = Math.sin(now * 0.002) * 0.1;
      currentRadius = openRadius + breathe;
      currentTilt = openTilt + (breathe * 0.1);
      currentSwirlOffset = 0; // Fully open
    } 
    else if (state.breathPhase === "exhale") {
      // CLOSING: Corkscrew back in
      currentRadius = openRadius - (eased * (openRadius - closedRadius));
      currentTilt = openTilt + (eased * (closedTilt - openTilt));
      currentSwirlOffset = eased * swirlAmount;
    }
    else { 
      // REST: Tight Bud
      currentRadius = closedRadius;
      currentTilt = closedTilt;
      currentSwirlOffset = swirlAmount;
      // Add slight idle drift
      currentTilt += Math.sin(now * 0.001 + i) * 0.05;
    }

    // Position Calculation
    petal.position.x = anchor.x + Math.cos(baseAngle + currentSwirlOffset) * currentRadius;
    petal.position.z = anchor.z + Math.sin(baseAngle + currentSwirlOffset) * currentRadius;
    petal.position.y = anchor.y;

    // Rotation Calculation
    // Y: Face outward + current swirl offset + slight spiral stagger
    petal.rotation.y = -baseAngle - currentSwirlOffset + (Math.PI / 2);
    // X: The tilt calculated above
    petal.rotation.x = currentTilt; 
    // Z: Gentle wave
    petal.rotation.z = Math.sin(flowTime * 2 + i) * 0.1;
  });
}

/* --- 5. CAMERA & MEDIAPIPE --- */
async function initFaceDetector() {
  if(els.faceStatus) els.faceStatus.textContent = "Loading AI...";
  
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );
  
  faceDetector = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.3, 
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3
  });
  
  els.faceStatus.textContent = 'AI Ready.';
}

const enableCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) return alert("getUserMedia() not supported.");
  
  els.btns.camera.disabled = true;
  els.btns.camera.textContent = "Loading...";

  if (!faceDetector) {
    try { await initFaceDetector(); } catch (e) {
      console.error(e);
      els.btns.camera.disabled = false;
      return;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    els.webcam.srcObject = stream;
    els.webcam.onloadedmetadata = () => {
        canvasCtx = els.canvas.getContext("2d");
        els.canvas.width = els.webcam.videoWidth;
        els.canvas.height = els.webcam.videoHeight;
        els.webcam.play();
        requestAnimationFrame(predictWebcam);
    };
    els.btns.camera.textContent = "Camera On";
    els.faceStatus.textContent = "Camera on. Breathe.";
  } catch (err) {
    console.error(err);
    els.btns.camera.disabled = false;
  }
};

async function predictWebcam() {
  if (!els.webcam || els.webcam.readyState < 2 || !faceDetector) {
    requestAnimationFrame(predictWebcam);
    return;
  }
  
  if (els.webcam.currentTime !== lastVideoTime) {
    lastVideoTime = els.webcam.currentTime;
    const result = await faceDetector.detectForVideo(els.webcam, performance.now());
    
    canvasCtx.clearRect(0, 0, els.canvas.width, els.canvas.height);

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      state.hasFace = true;
      const landmarks = result.faceLandmarks[0];
      
      const nose = landmarks[1];
      const worldX = ( (1 - nose.x) - 0.5 ) * 4.0;
      const worldY = (0.5 - nose.y) * 3.0 + 1.2;
      
      const target = new THREE.Vector3(worldX, worldY, 0);
      headAnchor.lerp(target, 0.1);

      if (headOccluder) {
        headOccluder.visible = true;
        headOccluder.position.copy(headAnchor);
        const faceWidth = Math.abs(landmarks[454].x - landmarks[234].x);
        headOccluder.scale.setScalar(faceWidth * 5.0);
      }
      els.faceStatus.textContent = "Face detected.";
      drawLiquidChromeFace(landmarks);

    } else {
      state.hasFace = false;
      els.faceStatus.textContent = "No face detected.";
    }
  }
  requestAnimationFrame(predictWebcam);
}

// --- FIX 2: VOLUMETRIC TEAL GLASS FACE RENDERER ---
function drawLiquidChromeFace(landmarks) {
  const ctx = canvasCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const time = performance.now() * 0.001;

  // Helper function for shapes
  const drawShape = (indices) => {
    ctx.beginPath();
    const first = landmarks[indices[0]];
    ctx.moveTo(first.x * w, first.y * h);
    for(let i=1; i<indices.length; i++) {
        const p = landmarks[indices[i]];
        // Liquid Wobble
        const wobbleX = Math.sin(time * 1.5 + p.y * 5) * 1.2;
        const wobbleY = Math.cos(time * 1.5 + p.x * 5) * 1.2;
        ctx.lineTo(p.x * w + wobbleX, p.y * h + wobbleY);
    }
    ctx.closePath();
  };

  const highFiFaceOval = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
  ];

  // --- LAYER 1: Base "Liquid Teal" Volume ---
  // We use a radial gradient to simulate thickness/depth
  // Center is lighter (thinner glass), edges are darker (thicker)
  const nose = landmarks[1];
  const cx = nose.x * w;
  const cy = nose.y * h;
  const faceWidth = Math.abs(landmarks[454].x - landmarks[234].x) * w;
  
  const baseGrad = ctx.createRadialGradient(cx, cy, faceWidth * 0.2, cx, cy, faceWidth * 1.5);
  baseGrad.addColorStop(0.0, "rgba(128, 222, 234, 0.9)"); // Center: Light Teal
  baseGrad.addColorStop(0.6, "rgba(0, 131, 143, 0.85)");  // Mid: Deep Cyan
  baseGrad.addColorStop(1.0, "rgba(0, 96, 100, 0.95)");   // Edge: Dark Teal
  
  ctx.save();
  ctx.fillStyle = baseGrad;
  // Soft outer glow to blend into background
  ctx.shadowBlur = 30;
  ctx.shadowColor = "rgba(38, 198, 218, 0.6)";
  drawShape(highFiFaceOval);
  ctx.fill();
  ctx.restore();

  // --- LAYER 2: Specular Highlights (The "3D" feel) ---
  // Instead of one flat reflection, we draw highlights on high points
  ctx.globalCompositeOperation = "screen"; // Additive blending for light
  
  // 2a. Nose Bridge Highlight
  const noseTop = landmarks[168]; // Glabella
  const noseTip = landmarks[1];
  const gradNose = ctx.createLinearGradient(noseTop.x*w, noseTop.y*h, noseTip.x*w, noseTip.y*h);
  gradNose.addColorStop(0, "rgba(255,255,255,0)");
  gradNose.addColorStop(0.5, "rgba(255,255,255,0.8)");
  gradNose.addColorStop(1, "rgba(255,255,255,0)");
  
  ctx.lineWidth = faceWidth * 0.15;
  ctx.strokeStyle = gradNose;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(noseTop.x*w, noseTop.y*h);
  ctx.lineTo(noseTip.x*w, noseTip.y*h);
  ctx.stroke();

  // 2b. Cheek Highlights (Blobs)
  const leftCheek = landmarks[50];
  const rightCheek = landmarks[280];
  
  ctx.fillStyle = "rgba(224, 247, 250, 0.4)";
  ctx.beginPath();
  ctx.arc(leftCheek.x*w, leftCheek.y*h, faceWidth*0.15, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(rightCheek.x*w, rightCheek.y*h, faceWidth*0.15, 0, Math.PI*2);
  ctx.fill();

  // --- LAYER 3: Dark Recesses (Eye Sockets / Mouth) ---
  // To simulate depth, we darken these areas
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(0, 77, 64, 0.5)"; // Deep transparent green/teal
  
  const leftEye = [33, 160, 158, 133, 153, 144, 362];
  const rightEye = [362, 385, 387, 263, 373, 380];
  const lips = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];

  drawShape(leftEye); ctx.fill();
  drawShape(rightEye); ctx.fill();
  drawShape(lips); ctx.fill();

  // --- LAYER 4: Final Sharp Gloss (Wet Look) ---
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 10;
  ctx.shadowColor = "white";
  
  // Tiny dot on nose tip
  ctx.beginPath();
  ctx.arc(noseTip.x * w, noseTip.y * h, 4, 0, Math.PI * 2);
  ctx.fill();
  
  // Tiny dots on lips
  const lipTop = landmarks[0];
  const lipBot = landmarks[17];
  ctx.beginPath();
  ctx.arc(lipTop.x * w, lipTop.y * h, 2, 0, Math.PI * 2);
  ctx.arc(lipBot.x * w, lipBot.y * h, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

/* --- 6. AUDIO --- */
function initAudioAnalyser() {
  if (!els.bgMusic) return;
  if (audioCtx) return;
  
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(els.bgMusic);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyserData = new Uint8Array(analyser.frequencyBinCount);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startOrbVisualizer() {
  if (!analyser || orbVizRunning) return;
  orbVizRunning = true;
  Object.values(els.orbs).forEach(orb => orb.classList.add("reactive"));
  requestAnimationFrame(orbVizLoop);
}

function stopOrbVisualizer() {
  orbVizRunning = false;
  Object.values(els.orbs).forEach(orb => {
    orb.style.transform = "";
    orb.classList.remove("reactive");
  });
}

function orbVizLoop() {
  if (!orbVizRunning || !analyser || !analyserData) return;
  analyser.getByteFrequencyData(analyserData);
  let sum = 0;
  for(let i=0; i<analyserData.length; i++) sum += analyserData[i];
  let level = sum / analyserData.length / 255;
  
  const scale = 1.0 + level * 0.3; 
  
  if(els.orbs.purple) els.orbs.purple.style.transform = `scale(${scale})`;
  if(els.orbs.blue)   els.orbs.blue.style.transform = `scale(${scale * 0.9})`;
  if(els.orbs.pink)   els.orbs.pink.style.transform = `scale(${scale * 1.1})`;
  
  requestAnimationFrame(orbVizLoop);
}

function chooseRandomTrack() {
  return musicTracks[Math.floor(Math.random() * musicTracks.length)];
}

function startMusic() {
  if (!els.bgMusic) return;
  if (!audioCtx) initAudioAnalyser();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  
  if (state.musicOn) return;
  
  const track = chooseRandomTrack();
  els.bgMusic.src = track;
  els.bgMusic.volume = 0.7;
  els.bgMusic.play().then(() => {
    state.musicOn = true;
    startOrbVisualizer();
  }).catch(e => console.error(e));
}

function toggleMusic() {
  if (!state.musicOn) {
    startMusic();
    els.btns.music.textContent = "Sound On";
  } else {
    stopMusic();
    els.btns.music.textContent = "Sound Off";
  }
}


function stopMusic() {
  if (!els.bgMusic || !state.musicOn) return;
  els.bgMusic.pause();
  state.musicOn = false;
  stopOrbVisualizer();
}

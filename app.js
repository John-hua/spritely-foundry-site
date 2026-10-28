import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  port: $("#portLabel"), projectName: $("#projectName"), dropZone: $("#dropZone"), fileInput: $("#fileInput"), browse: $("#browseButton"), example: $("#exampleButton"), headerImport: $("#headerImportButton"),
  viewport: $("#viewport"), canvasHost: $("#canvasHost"), statusLine: $("#statusLine"), status: $("#statusText"), modelStats: $("#modelStats"), captureFrame: $("#captureFrame"), frameLabel: $("#frameLabel"),
  play: $("#playButton"), previousFrame: $("#previousFrameButton"), nextFrame: $("#nextFrameButton"), timeline: $("#timelineInput"), timelineTime: $("#timelineTime"),
  reset: $("#resetButton"), focus: $("#focusButton"), front: $("#frontButton"), toggleFrame: $("#toggleFrameButton"), compassDial: $("#compassDial"), compassValue: $("#compassValue"),
  animation: $("#animationSelect"), form: $("#settingsForm"), savedState: $("#savedState"),
  directions: $("#directionsInput"), frames: $("#framesInput"), width: $("#widthInput"), height: $("#heightInput"),
  elevation: $("#elevationInput"), elevationOutput: $("#elevationOutput"), margin: $("#marginInput"), marginOutput: $("#marginOutput"),
  color: $("#colorInput"), sheetMath: $("#sheetMath"), totalFrames: $("#totalFrames"), generate: $("#generateButton"), buttonProgress: $("#buttonProgress"),
  resultInfo: $("#resultInfo"), resultEmpty: $("#resultEmpty"), preview: $("#sheetPreview"), packageName: $("#packageName"),
  download: $("#downloadButton"), downloadSheet: $("#downloadSheetButton"), dockToggle: $("#dockToggle"), resultPanel: $("#resultPanel"), studio: $(".studio"),
  sheetTab: $("#sheetTab"), directionsTab: $("#directionsTab"), sheetPane: $("#sheetPane"), directionPane: $("#directionPane"),
  directionPlay: $("#directionPlayButton"), directionAnimationName: $("#directionAnimationName"), directionFrameCounter: $("#directionFrameCounter"),
};
const directionImages = [...document.querySelectorAll(".direction-card")].map((card) => ({ card, image: card.querySelector("img"), direction: Number(card.dataset.direction) }));

elements.port.textContent = location.port || "HTTPS";
let modelGroup = null;
let mixer = null;
let clips = [];
let activeAction = null;
let modelRadius = 1;
let sourceName = "model";
let isPlaying = true;
let isGenerating = false;
let selectedBackground = "transparent";
let zipBlob = null;
let sheetPngBlob = null;
let previewUrl = null;
let objectUrls = [];
let previewDirection = 0;
let directionFrameUrls = [];
let directionPreviewPlaying = true;
let directionPreviewFrame = 0;
let directionPreviewLastTick = 0;
let directionPreviewStepMs = 125;

const scene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
const captureCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
elements.canvasHost.appendChild(renderer.domElement);
const controls = new OrbitControls(previewCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x303936, 2.25));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(4, 7, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x7dffe1, 1.25);
rimLight.position.set(-5, 2, -4);
scene.add(rimLight);
const clock = new THREE.Clock();

function setStatus(message, kind = "idle") {
  elements.status.textContent = message;
  elements.statusLine.dataset.kind = kind;
}

function resizePreview() {
  const { width, height } = elements.canvasHost.getBoundingClientRect();
  renderer.setSize(Math.max(1, width), Math.max(1, height), false);
  previewCamera.aspect = width / Math.max(1, height);
  previewCamera.updateProjectionMatrix();
}
new ResizeObserver(resizePreview).observe(elements.canvasHost);

function previewLoop() {
  requestAnimationFrame(previewLoop);
  const delta = Math.min(clock.getDelta(), 0.05);
  if (mixer && isPlaying && !isGenerating) mixer.update(delta);
  if (activeAction && !isGenerating) {
    const duration = activeAction.getClip().duration || 1;
    const progress = Math.min(1, activeAction.time / duration);
    elements.timeline.value = String(Math.round(progress * 1000));
    elements.timeline.style.setProperty("--timeline-progress", `${progress * 100}%`);
    elements.timelineTime.value = formatTime(activeAction.time);
  }
  controls.update();
  renderer.render(scene, previewCamera);
}
previewLoop();

function revokeDirectionPreview() {
  for (const frames of directionFrameUrls) for (const url of frames) URL.revokeObjectURL(url);
  directionFrameUrls = [];
  directionImages.forEach(({ image }) => image.removeAttribute("src"));
  elements.directionsTab.disabled = true;
}

function renderDirectionPreviewFrame(frameIndex) {
  if (!directionFrameUrls.length) return;
  directionPreviewFrame = frameIndex % directionFrameUrls[0].length;
  for (const { image, direction } of directionImages) image.src = directionFrameUrls[direction][directionPreviewFrame];
  elements.directionFrameCounter.value = `${String(directionPreviewFrame + 1).padStart(2, "0")} / ${String(directionFrameUrls[0].length).padStart(2, "0")}`;
}

function directionPreviewLoop(timestamp) {
  requestAnimationFrame(directionPreviewLoop);
  if (!directionPreviewPlaying || !directionFrameUrls.length || elements.directionPane.hidden) return;
  if (timestamp - directionPreviewLastTick < directionPreviewStepMs) return;
  directionPreviewLastTick = timestamp;
  renderDirectionPreviewFrame(directionPreviewFrame + 1);
}
requestAnimationFrame(directionPreviewLoop);

function setOutputPreviewMode(mode) {
  const directions = mode === "directions" && !elements.directionsTab.disabled;
  elements.sheetPane.hidden = directions;
  elements.directionPane.hidden = !directions;
  elements.sheetTab.classList.toggle("active", !directions);
  elements.sheetTab.setAttribute("aria-selected", String(!directions));
  elements.directionsTab.classList.toggle("active", directions);
  elements.directionsTab.setAttribute("aria-selected", String(directions));
  elements.studio.classList.toggle("direction-preview-mode", directions);
  if (directions) {
    elements.resultPanel.classList.remove("collapsed");
    elements.dockToggle.innerHTML = "收起 <span>⌄</span>";
    renderDirectionPreviewFrame(directionPreviewFrame);
  }
}

function prepareDirectionPreview(frameBlobs, clip) {
  revokeDirectionPreview();
  if (frameBlobs.length !== 8 || frameBlobs.some((frames) => !frames.length)) {
    elements.directionsTab.title = "请将方向数设置为 8 后重新生成";
    setOutputPreviewMode("sheet");
    return;
  }
  directionFrameUrls = frameBlobs.map((frames) => frames.map((blob) => URL.createObjectURL(blob)));
  directionPreviewFrame = 0;
  directionPreviewPlaying = true;
  directionPreviewLastTick = performance.now();
  directionPreviewStepMs = Math.max(70, Math.min(500, ((clip?.duration || 1) * 1000) / frameBlobs[0].length));
  elements.directionAnimationName.textContent = clip?.name || "STATIC";
  elements.directionPlay.querySelector("i").textContent = frameBlobs[0].length > 1 ? "Ⅱ" : "■";
  elements.directionPlay.disabled = frameBlobs[0].length <= 1;
  elements.directionsTab.disabled = false;
  elements.directionsTab.title = "以九宫格同步预览八个方向";
  renderDirectionPreviewFrame(0);
  setOutputPreviewMode("directions");
}

function formatTime(seconds = 0) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function focusModel(angle = (previewDirection * 360) / Math.max(1, settings().directions)) {
  if (!modelGroup) return;
  const value = settings();
  const azimuth = THREE.MathUtils.degToRad(angle);
  const elevation = THREE.MathUtils.degToRad(value.elevation);
  const distance = modelRadius * 3.55 * (1 + value.margin);
  previewCamera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
  previewCamera.near = Math.max(.001, modelRadius / 100);
  previewCamera.far = modelRadius * 30;
  previewCamera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = modelRadius * .8;
  controls.maxDistance = modelRadius * 12;
  controls.update();
  elements.viewport.dataset.previewElevation = String(value.elevation);
  elements.viewport.dataset.previewMargin = String(value.margin);
  elements.viewport.dataset.previewDistance = String(distance);
  elements.viewport.dataset.previewCameraY = String(previewCamera.position.y);
}

function revokeObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function disposeModel() {
  if (!modelGroup) return;
  scene.remove(modelGroup);
  modelGroup.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
  modelGroup = null;
  mixer = null;
  clips = [];
  activeAction = null;
}

function normalizeModel(object) {
  modelGroup = new THREE.Group();
  modelGroup.add(object);
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.frustumCulled = false;
    if (!node.material) node.material = new THREE.MeshStandardMaterial({ color: 0xbac6bd });
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) { material.side = THREE.DoubleSide; material.needsUpdate = true; }
  });
  modelGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (box.isEmpty()) throw new Error("模型没有可渲染的几何体");
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  modelGroup.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(modelGroup).getBoundingSphere(new THREE.Sphere());
  modelRadius = Math.max(sphere.radius, 0.001);
  scene.add(modelGroup);

  focusModel();
}

function fileLookup(files) {
  const urls = new Map();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    urls.set(file.name, url);
    if (file.webkitRelativePath) urls.set(file.webkitRelativePath, url);
  }
  return urls;
}

async function loadFiles(fileList) {
  const files = [...fileList];
  const main = files.find((file) => /\.(glb|gltf|obj)$/i.test(file.name));
  if (!main) throw new Error("没有找到 GLB、glTF 或 OBJ 模型文件");
  disposeModel();
  revokeObjectUrls();
  setStatus(`正在解析 ${main.name}…`, "busy");
  elements.generate.disabled = true;
  sourceName = main.name.replace(/\.[^.]+$/, "");
  const urls = fileLookup(files);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const decoded = decodeURIComponent(url).replace(/^\.\//, "");
    return urls.get(decoded) || urls.get(decoded.split("/").pop()) || url;
  });
  const mainUrl = urls.get(main.name);
  let object;
  if (/\.obj$/i.test(main.name)) {
    object = await new OBJLoader(manager).loadAsync(mainUrl);
    clips = object.animations || [];
  } else {
    const gltf = await new GLTFLoader(manager).loadAsync(mainUrl);
    object = gltf.scene;
    clips = gltf.animations || [];
  }
  normalizeModel(object);
  mixer = clips.length ? new THREE.AnimationMixer(modelGroup) : null;
  populateAnimations();
  elements.dropZone.classList.add("loaded");
  elements.projectName.textContent = sourceName.toUpperCase();
  elements.modelStats.textContent = `${main.name} · ${clips.length} 个动画片段`;
  elements.play.disabled = !clips.length;
  elements.previousFrame.disabled = !clips.length;
  elements.nextFrame.disabled = !clips.length;
  elements.timeline.disabled = !clips.length;
  elements.generate.disabled = false;
  setStatus(`已载入 ${main.name}，所有处理均在本机完成`, "success");
  updateMath();
}

async function loadExampleModel() {
  const defaultLabel = elements.example.innerHTML;
  elements.example.disabled = true;
  elements.example.textContent = "正在载入示例…";
  try {
    const response = await fetch("/examples/Fox.glb");
    if (!response.ok) throw new Error(`示例模型下载失败（HTTP ${response.status}）`);
    const blob = await response.blob();
    const file = new File([blob], "Fox.glb", { type: "model/gltf-binary" });
    await loadFiles([file]);
    setStatus("Fox 示例已载入：可切换 Survey、Walk、Run 动画", "success");
  } finally {
    elements.example.disabled = false;
    elements.example.innerHTML = defaultLabel;
  }
}

function populateAnimations() {
  elements.animation.innerHTML = "";
  if (!clips.length) {
    elements.animation.add(new Option("静态模型", "-1"));
    elements.animation.disabled = true;
    elements.frames.value = "1";
    elements.frames.disabled = true;
    elements.timeline.disabled = true;
    return;
  }
  clips.forEach((clip, index) => elements.animation.add(new Option(`${clip.name || `Animation ${index + 1}`} · ${clip.duration.toFixed(2)}s`, String(index))));
  elements.animation.disabled = false;
  elements.frames.disabled = false;
  selectAnimation(0);
}

function selectAnimation(index) {
  if (!mixer || index < 0 || !clips[index]) return;
  mixer.stopAllAction();
  activeAction = mixer.clipAction(clips[index]);
  activeAction.reset().play();
  isPlaying = true;
  elements.play.querySelector("span").textContent = "Ⅱ";
  elements.timeline.value = "0";
  elements.timeline.style.setProperty("--timeline-progress", "0%");
  elements.timelineTime.value = formatTime(0);
}

function numeric(element, min, max) {
  return Math.max(min, Math.min(max, Number.parseInt(element.value, 10) || min));
}

function settings() {
  return {
    directions: numeric(elements.directions, 1, 64),
    frames: clips.length ? numeric(elements.frames, 1, 64) : 1,
    width: numeric(elements.width, 16, 2048),
    height: numeric(elements.height, 16, 2048),
    elevation: Number(elements.elevation.value),
    margin: Number(elements.margin.value) / 100,
    background: selectedBackground,
    animationIndex: Number(elements.animation.value),
  };
}

function updateMath() {
  const value = settings();
  elements.sheetMath.textContent = `${value.width * value.frames} × ${value.height * value.directions} PX`;
  elements.totalFrames.textContent = String(value.directions * value.frames);
  elements.elevationOutput.value = `${value.elevation}°`;
  elements.marginOutput.value = `${Math.round(value.margin * 100)}%`;
  elements.compassValue.textContent = String(value.directions);
  elements.frameLabel.textContent = `${value.width} × ${value.height}`;
  elements.captureFrame.style.setProperty("--frame-ratio", String(value.width / value.height));
  previewDirection %= Math.max(1, value.directions);
  document.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("active", Number(button.dataset.value) === value.directions));
  document.querySelectorAll(".size-presets button").forEach((button) => button.classList.toggle("active", Number(button.dataset.size) === value.width && value.width === value.height));
  localStorage.setItem("spritely-settings", JSON.stringify({ directions: value.directions, frames: value.frames, width: value.width, height: value.height, elevation: value.elevation, margin: Math.round(value.margin * 100), background: value.background }));
  elements.savedState.textContent = "已保存";
  if (modelGroup) focusModel();
}

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("spritely-settings") || "null");
    if (!saved) return;
    for (const [element, value] of [[elements.directions, saved.directions], [elements.frames, saved.frames], [elements.width, saved.width], [elements.height, saved.height], [elements.elevation, saved.elevation], [elements.margin, saved.margin]]) {
      if (value !== undefined) element.value = String(value);
    }
    if (saved.background) selectedBackground = saved.background;
  } catch { /* Ignore invalid settings from older versions. */ }
}

function setGenerationProgress(percent, label = "正在渲染") {
  const safe = Math.max(0, Math.min(100, percent));
  elements.generate.style.setProperty("--render-progress", `${safe}%`);
  elements.buttonProgress.textContent = safe >= 100 ? "已完成" : `${label} ${Math.round(safe)}%`;
}

function fitCaptureCamera(angle, elevation, width, height, margin) {
  const azimuth = THREE.MathUtils.degToRad(angle);
  const tilt = THREE.MathUtils.degToRad(elevation);
  const distance = modelRadius * 4;
  captureCamera.position.set(Math.sin(azimuth) * Math.cos(tilt) * distance, Math.sin(tilt) * distance, Math.cos(azimuth) * Math.cos(tilt) * distance);
  captureCamera.lookAt(0, 0, 0);
  const aspect = width / height;
  const halfHeight = modelRadius * (1 + margin);
  if (aspect >= 1) {
    captureCamera.left = -halfHeight * aspect; captureCamera.right = halfHeight * aspect;
    captureCamera.top = halfHeight; captureCamera.bottom = -halfHeight;
  } else {
    captureCamera.left = -halfHeight; captureCamera.right = halfHeight;
    captureCamera.top = halfHeight / aspect; captureCamera.bottom = -halfHeight / aspect;
  }
  captureCamera.near = Math.max(.001, distance - modelRadius * 2.5);
  captureCamera.far = distance + modelRadius * 2.5;
  captureCamera.updateProjectionMatrix();
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法编码 PNG")), "image/png"));
}

async function generateSprites(event) {
  event.preventDefault();
  if (!modelGroup) return;
  const config = settings();
  const sheetWidth = config.width * config.frames;
  const sheetHeight = config.height * config.directions;
  if (sheetWidth > 32767 || sheetHeight > 32767 || sheetWidth * sheetHeight > 120_000_000) {
    setStatus("图集尺寸过大，请降低单帧尺寸、方向数或帧数", "error");
    return;
  }
  elements.generate.disabled = true;
  elements.download.disabled = true;
  elements.downloadSheet.disabled = true;
  isGenerating = true;
  revokeDirectionPreview();
  setOutputPreviewMode("sheet");
  setGenerationProgress(0);
  setStatus("正在离屏渲染 Sprite 帧…", "busy");
  const captureRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  captureRenderer.outputColorSpace = THREE.SRGBColorSpace;
  captureRenderer.setPixelRatio(1);
  captureRenderer.setSize(config.width, config.height, false);
  if (config.background === "transparent") captureRenderer.setClearColor(0x000000, 0);
  else captureRenderer.setClearColor(new THREE.Color(config.background), 1);

  const sheet = document.createElement("canvas");
  sheet.width = sheetWidth;
  sheet.height = sheetHeight;
  const context = sheet.getContext("2d");
  const zip = new window.JSZip();
  const frameFolder = zip.folder("frames");
  const directionFrameBlobs = Array.from({ length: config.directions }, () => []);
  const clip = config.animationIndex >= 0 ? clips[config.animationIndex] : null;
  if (mixer && clip) { mixer.stopAllAction(); activeAction = mixer.clipAction(clip); activeAction.reset().play(); }
  const records = [];
  const total = config.directions * config.frames;
  let completed = 0;
  try {
    for (let direction = 0; direction < config.directions; direction += 1) {
      const angle = (direction * 360) / config.directions;
      for (let frame = 0; frame < config.frames; frame += 1) {
        const time = clip ? (frame / config.frames) * clip.duration : 0;
        if (mixer && clip) { mixer.setTime(time); modelGroup.updateMatrixWorld(true); }
        fitCaptureCamera(angle, config.elevation, config.width, config.height, config.margin);
        captureRenderer.render(scene, captureCamera);
        context.drawImage(captureRenderer.domElement, frame * config.width, direction * config.height);
        const frameBlob = await canvasBlob(captureRenderer.domElement);
        directionFrameBlobs[direction][frame] = frameBlob;
        const file = `direction-${String(direction + 1).padStart(2, "0")}_frame-${String(frame + 1).padStart(2, "0")}.png`;
        frameFolder.file(file, frameBlob);
        records.push({ file: `frames/${file}`, direction: direction + 1, frame: frame + 1, angle, time, x: frame * config.width, y: direction * config.height, width: config.width, height: config.height });
        completed += 1;
        setGenerationProgress((completed / total) * 78);
        await new Promise(requestAnimationFrame);
      }
    }
    sheetPngBlob = await canvasBlob(sheet);
    zip.file("sheet.png", sheetPngBlob);
    const metadata = {
      generator: "Spritely Local WebUI 1.4",
      generatedAt: new Date().toISOString(),
      source: sourceName,
      animation: clip?.name || "Static",
      duration: clip?.duration || 0,
      layout: { columns: config.frames, rows: config.directions },
      frameSize: { width: config.width, height: config.height },
      elevation: config.elevation,
      background: config.background,
      frames: records,
    };
    zip.file("metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
    setGenerationProgress(82, "正在打包");
    zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }, ({ percent }) => {
      setGenerationProgress(82 + percent * .18, "正在打包");
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(sheetPngBlob);
    elements.preview.src = previewUrl;
    elements.preview.hidden = false;
    elements.resultEmpty.hidden = true;
    elements.resultInfo.textContent = `${config.directions} 个方向 × ${config.frames} 帧 · ${(zipBlob.size / 1024 / 1024).toFixed(2)} MB`;
    elements.packageName.textContent = `${sourceName}-sprites.zip`;
    elements.download.disabled = false;
    elements.downloadSheet.disabled = false;
    prepareDirectionPreview(directionFrameBlobs, clip);
    setGenerationProgress(100);
    setStatus(`生成完成：${total} 帧已打包，可下载 ZIP`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`生成失败：${error.message}`, "error");
  } finally {
    captureRenderer.dispose();
    isGenerating = false;
    elements.generate.disabled = false;
  }
}

function downloadZip() {
  if (!zipBlob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = `${sourceName}-sprites.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadSheet() {
  if (!sheetPngBlob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(sheetPngBlob);
  link.download = `${sourceName}-sheet.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function resetProject() {
  disposeModel();
  revokeObjectUrls();
  revokeDirectionPreview();
  setOutputPreviewMode("sheet");
  elements.dropZone.classList.remove("loaded");
  elements.fileInput.value = "";
  elements.animation.innerHTML = "<option>请先载入模型</option>";
  elements.animation.disabled = true;
  elements.generate.disabled = true;
  elements.download.disabled = true;
  elements.downloadSheet.disabled = true;
  elements.play.disabled = true;
  elements.previousFrame.disabled = true;
  elements.nextFrame.disabled = true;
  elements.timeline.disabled = true;
  elements.frames.disabled = false;
  elements.modelStats.textContent = "等待导入 3D 模型";
  elements.projectName.textContent = "UNTITLED ASSET";
  elements.preview.hidden = true;
  elements.resultEmpty.hidden = false;
  elements.resultInfo.textContent = "生成后可在这里核对图集";
  elements.packageName.textContent = "等待输出";
  zipBlob = null;
  sheetPngBlob = null;
  setGenerationProgress(0, "开始渲染");
  elements.buttonProgress.textContent = "开始渲染";
  setStatus("准备就绪", "idle");
}

elements.browse.addEventListener("click", (event) => { event.preventDefault(); elements.fileInput.click(); });
elements.example.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  loadExampleModel().catch((error) => setStatus(error.message, "error"));
});
elements.headerImport.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => loadFiles(elements.fileInput.files).catch((error) => setStatus(error.message, "error")));
for (const eventName of ["dragenter", "dragover"]) elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.add("dragging"); });
for (const eventName of ["dragleave", "drop"]) elements.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); elements.dropZone.classList.remove("dragging"); });
elements.dropZone.addEventListener("drop", (event) => loadFiles(event.dataTransfer.files).catch((error) => setStatus(error.message, "error")));
elements.animation.addEventListener("change", () => selectAnimation(Number(elements.animation.value)));
elements.play.addEventListener("click", () => { isPlaying = !isPlaying; elements.play.querySelector("span").textContent = isPlaying ? "Ⅱ" : "▶"; });
elements.timeline.addEventListener("input", () => {
  if (!activeAction || !mixer) return;
  isPlaying = false;
  elements.play.querySelector("span").textContent = "▶";
  const time = (Number(elements.timeline.value) / 1000) * activeAction.getClip().duration;
  mixer.setTime(time);
  elements.timeline.style.setProperty("--timeline-progress", `${Number(elements.timeline.value) / 10}%`);
  elements.timelineTime.value = formatTime(time);
});
function stepAnimation(direction) {
  if (!activeAction || !mixer) return;
  isPlaying = false;
  elements.play.querySelector("span").textContent = "▶";
  const clip = activeAction.getClip();
  const step = clip.duration / Math.max(1, numeric(elements.frames, 1, 64));
  const time = Math.max(0, Math.min(clip.duration, activeAction.time + step * direction));
  mixer.setTime(time);
  elements.timeline.value = String(Math.round((time / clip.duration) * 1000));
  elements.timeline.style.setProperty("--timeline-progress", `${(time / clip.duration) * 100}%`);
}
elements.previousFrame.addEventListener("click", () => stepAnimation(-1));
elements.nextFrame.addEventListener("click", () => stepAnimation(1));
elements.reset.addEventListener("click", resetProject);
elements.focus.addEventListener("click", () => focusModel());
elements.front.addEventListener("click", () => { previewDirection = 0; focusModel(0); });
elements.compassDial.addEventListener("click", () => { previewDirection = (previewDirection + 1) % settings().directions; focusModel((previewDirection * 360) / settings().directions); });
elements.toggleFrame.addEventListener("click", () => { elements.captureFrame.classList.toggle("hidden"); elements.toggleFrame.classList.toggle("active"); });
elements.form.addEventListener("submit", generateSprites);
elements.download.addEventListener("click", downloadZip);
elements.downloadSheet.addEventListener("click", downloadSheet);
elements.sheetTab.addEventListener("click", () => setOutputPreviewMode("sheet"));
elements.directionsTab.addEventListener("click", () => setOutputPreviewMode("directions"));
elements.directionPlay.addEventListener("click", () => {
  directionPreviewPlaying = !directionPreviewPlaying;
  elements.directionPlay.querySelector("i").textContent = directionPreviewPlaying ? "Ⅱ" : "▶";
  elements.directionPlay.querySelector("small").textContent = directionPreviewPlaying ? "同步播放" : "继续播放";
  directionPreviewLastTick = performance.now();
});
elements.dockToggle.addEventListener("click", () => {
  elements.resultPanel.classList.toggle("collapsed");
  const collapsed = elements.resultPanel.classList.contains("collapsed");
  elements.dockToggle.innerHTML = `${collapsed ? "展开" : "收起"} <span>${collapsed ? "⌃" : "⌄"}</span>`;
});
for (const input of [elements.directions, elements.frames, elements.width, elements.height, elements.elevation, elements.margin]) input.addEventListener("input", updateMath);
document.querySelectorAll(".segmented button").forEach((button) => button.addEventListener("click", () => { elements.directions.value = button.dataset.value; updateMath(); }));
document.querySelectorAll(".size-presets button").forEach((button) => button.addEventListener("click", () => { elements.width.value = button.dataset.size; elements.height.value = button.dataset.size; updateMath(); }));
document.querySelectorAll(".stepper button").forEach((button) => button.addEventListener("click", () => {
  const input = document.getElementById(button.dataset.for);
  const next = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) + Number(button.dataset.step)));
  input.value = String(next); updateMath();
}));
document.querySelectorAll(".bg-option").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".bg-option").forEach((item) => item.classList.remove("active"));
  button.classList.add("active"); selectedBackground = button.dataset.background; updateMath();
}));
elements.color.addEventListener("input", () => { document.querySelectorAll(".bg-option").forEach((item) => item.classList.remove("active")); selectedBackground = elements.color.value; updateMath(); });
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); elements.fileInput.click(); } });
restoreSettings();
updateMath();

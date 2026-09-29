const referenceModel = {
  schemaVersion: "P123-SPACE-0.1.0",
  modelType: "parametric_indoor_space",
  name: "P123 Empty Room 3x6x3m",
  unit: "meter",
  coordinateSystem: {
    handedness: "right",
    upAxis: "Y",
    horizontalAxes: ["X", "Z"],
    origin: "floor_corner_A",
    description: "X is room width, Y is height, and Z is room length."
  },
  calibration: {
    method: "manual_dimensions",
    referenceObject: null,
    scaleConfirmed: true
  },
  room: {
    shape: "rectangular_prism",
    dimensions: { width: 3, length: 6, height: 3 },
    floorPolygon: [
      { x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 6 }, { x: 0, z: 6 }
    ],
    floorElevation: 0,
    ceilingElevation: 3
  },
  walls: [
    { id: "W01", label: "Wall A", start: { x: 0, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0 }, height: 3, thickness: 0.1 },
    { id: "W02", label: "Wall B", start: { x: 3, y: 0, z: 0 }, end: { x: 3, y: 0, z: 6 }, height: 3, thickness: 0.1 },
    { id: "W03", label: "Wall C", start: { x: 3, y: 0, z: 6 }, end: { x: 0, y: 0, z: 6 }, height: 3, thickness: 0.1 },
    { id: "W04", label: "Wall D", start: { x: 0, y: 0, z: 6 }, end: { x: 0, y: 0, z: 0 }, height: 3, thickness: 0.1 }
  ],
  openings: [],
  obstacles: [],
  measurements: [
    { id: "M01", type: "room_width", value: 3, unit: "meter" },
    { id: "M02", type: "room_length", value: 6, unit: "meter" },
    { id: "M03", type: "room_height", value: 3, unit: "meter" }
  ],
  quality: {
    status: "reference_model",
    geometryConfidence: 1,
    notes: "Manually defined empty rectangular room for P123 viewer testing."
  }
};

const viewport = document.querySelector("#viewport");
const loading = document.querySelector("#loading");
const fileInput = document.querySelector("#fileInput");
const jsonDialog = document.querySelector("#jsonDialog");
const toast = document.querySelector("#toast");

let currentModel = structuredClone(referenceModel);
let currentFilename = "P123_EmptyRoom_3x6x3m.json";
let currentSampleKey = "empty";
let modelGroup;
let dimensionGroup;
let ceilingMesh;
let grid;
let toastTimer;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111b);
scene.fog = new THREE.Fog(0x07111b, 18, 42);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
camera.position.set(8.8, 7.2, 10.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.prepend(renderer.domElement);

const labelRenderer = new THREE.CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
labelRenderer.domElement.style.zIndex = "4";
viewport.append(labelRenderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xb8eaff, 0x17202b, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 9, 5);
scene.add(keyLight);

function validateModel(data) {
  if (!data || typeof data !== "object") throw new Error("JSON 內容不是有效物件。");
  if (!data.room || !data.room.dimensions) throw new Error("缺少 room.dimensions。");
  const { width, length, height } = data.room.dimensions;
  if (![width, length, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("房間的寬、長、高必須是正數。");
  }
  if (!Array.isArray(data.room.floorPolygon) || data.room.floorPolygon.length < 3) {
    throw new Error("floorPolygon 至少需要三個頂點。");
  }
  if (!Array.isArray(data.walls)) throw new Error("缺少 walls 陣列。");
  if (data.unit && data.unit !== "meter") throw new Error("V0.1 目前只支援 meter 單位。");
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0) / 2);
}

function material(color, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    roughness: 0.72,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
}

function addEdges(mesh, color = 0x5ccbe0, opacity = 0.74) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
  edges.renderOrder = 3;
  mesh.add(edges);
}

function createFloor(data) {
  const shape = new THREE.Shape();
  data.room.floorPolygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material(0x172c3a, 0.96));
  mesh.position.y = data.room.floorElevation ?? 0;
  mesh.name = "Floor";
  mesh.userData.p123Type = "floor";
  addEdges(mesh, 0x76dfee, 0.5);
  return mesh;
}

function createCeiling(data) {
  const shape = new THREE.Shape();
  data.room.floorPolygon.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material(0x6cc8d7, 0.1));
  mesh.position.y = data.room.ceilingElevation ?? data.room.dimensions.height;
  mesh.name = "Ceiling";
  mesh.userData.p123Type = "ceiling";
  addEdges(mesh, 0x74d8e9, 0.38);
  return mesh;
}

function createWall(wall, defaultHeight) {
  const start = wall.start;
  const end = wall.end;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const wallLength = Math.hypot(dx, dz);
  const height = wall.height ?? defaultHeight;
  const thickness = wall.thickness ?? 0.1;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(wallLength, height, thickness),
    material(0x4e91aa, 0.32)
  );
  mesh.position.set((start.x + end.x) / 2, height / 2, (start.z + end.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.name = wall.label || wall.id || "Wall";
  mesh.userData = { ...wall, p123Type: "wall" };
  addEdges(mesh);
  return mesh;
}

function createObstacle(item) {
  const size = item.size || {};
  const width = size.width ?? 1;
  const height = size.height ?? 1;
  const depth = size.depth ?? 1;
  const position = item.position || {};
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material(0xe0a34f, 0.48)
  );
  mesh.position.set(position.x ?? 0, position.y ?? height / 2, position.z ?? 0);
  mesh.rotation.y = -(item.rotationY ?? 0);
  mesh.name = item.label || item.id || "Obstacle";
  mesh.userData = { ...item, p123Type: "obstacle" };
  addEdges(mesh, 0xffc66f, 0.86);
  return mesh;
}

function dimensionLabel(text) {
  const element = document.createElement("div");
  element.className = "dimension-label";
  element.textContent = text;
  return new THREE.CSS2DObject(element);
}

function addDimension(start, end, text, offset) {
  const a = start.clone().add(offset);
  const b = end.clone().add(offset);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x63dced, transparent: true, opacity: 0.94 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMaterial);
  dimensionGroup.add(line);

  const direction = b.clone().sub(a).normalize();
  const cameraFacing = new THREE.Vector3(0, 1, 0);
  let tickVector = new THREE.Vector3().crossVectors(direction, cameraFacing).normalize().multiplyScalar(0.09);
  if (tickVector.lengthSq() < 0.01) tickVector = new THREE.Vector3(0.09, 0, 0);
  [a, b].forEach(point => {
    const tick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([point.clone().sub(tickVector), point.clone().add(tickVector)]),
      lineMaterial
    );
    dimensionGroup.add(tick);
  });

  const label = dimensionLabel(text);
  label.position.copy(a).lerp(b, 0.5);
  dimensionGroup.add(label);
}

function buildDimensions(data) {
  const { width, length, height } = data.room.dimensions;
  addDimension(
    new THREE.Vector3(0, 0.04, 0),
    new THREE.Vector3(width, 0.04, 0),
    `${width.toFixed(2)} m`,
    new THREE.Vector3(0, 0, -0.34)
  );
  addDimension(
    new THREE.Vector3(width, 0.04, 0),
    new THREE.Vector3(width, 0.04, length),
    `${length.toFixed(2)} m`,
    new THREE.Vector3(0.34, 0, 0)
  );
  addDimension(
    new THREE.Vector3(width, 0, length),
    new THREE.Vector3(width, height, length),
    `${height.toFixed(2)} m`,
    new THREE.Vector3(0.34, 0, 0.34)
  );
}

function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(item => item.dispose?.());
    else object.material?.dispose?.();
    if (object.element?.remove) object.element.remove();
  });
  scene.remove(root);
}

function buildModel(data, filename = "space.json") {
  validateModel(data);
  if (modelGroup) disposeObject(modelGroup);
  if (dimensionGroup) disposeObject(dimensionGroup);
  if (grid) disposeObject(grid);

  currentModel = structuredClone(data);
  currentFilename = filename;
  modelGroup = new THREE.Group();
  modelGroup.name = data.name || "P123 Space";
  dimensionGroup = new THREE.Group();
  dimensionGroup.name = "P123 Dimensions";

  modelGroup.add(createFloor(data));
  ceilingMesh = createCeiling(data);
  ceilingMesh.visible = document.querySelector("#ceilingToggle").checked;
  modelGroup.add(ceilingMesh);
  data.walls.forEach(wall => modelGroup.add(createWall(wall, data.room.dimensions.height)));
  (data.obstacles || []).forEach(item => modelGroup.add(createObstacle(item)));
  buildDimensions(data);

  const maxSize = Math.max(data.room.dimensions.width, data.room.dimensions.length, data.room.dimensions.height);
  grid = new THREE.GridHelper(Math.max(10, Math.ceil(maxSize * 1.8)), Math.max(10, Math.ceil(maxSize * 1.8)), 0x31566a, 0x183142);
  grid.position.y = 0.005;
  grid.material.transparent = true;
  grid.material.opacity = 0.52;

  scene.add(grid, modelGroup, dimensionGroup);
  updateInspector(data);
  fitPerspective();
}

function updateInspector(data) {
  const dims = data.room.dimensions;
  document.querySelector("#spaceName").textContent = data.name || "未命名空間";
  document.querySelector("#schemaVersion").textContent = data.schemaVersion || "未標示版本";
  document.querySelector("#modelStatus").textContent = data.quality?.status === "reference_model" ? "基準模型" : "已載入模型";
  document.querySelector("#widthValue").textContent = dims.width.toFixed(2);
  document.querySelector("#lengthValue").textContent = dims.length.toFixed(2);
  document.querySelector("#heightValue").textContent = dims.height.toFixed(2);
  document.querySelector("#areaValue").textContent = polygonArea(data.room.floorPolygon).toFixed(2);
  document.querySelector("#wallCount").textContent = data.walls.length;
  document.querySelector("#openingCount").textContent = (data.openings || []).length;
  document.querySelector("#obstacleCount").textContent = (data.obstacles || []).length;
  document.querySelector("#originValue").textContent = data.coordinateSystem?.origin || "未定義";
  document.querySelector("#unitBadge").textContent = data.unit || "meter";
  document.querySelector("#qualityNote").textContent = data.quality?.notes || "未提供資料品質說明。";
  document.querySelector("#jsonContent").textContent = JSON.stringify(data, null, 2);
}

function setActiveView(name) {
  document.querySelectorAll(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
}

function fitPerspective() {
  const { width, length, height } = currentModel.room.dimensions;
  const center = new THREE.Vector3(width / 2, height * 0.42, length / 2);
  const radius = Math.max(width, length, height);
  camera.up.set(0, 1, 0);
  camera.position.set(center.x + radius * 1.18, center.y + radius * 0.9, center.z + radius * 1.18);
  controls.target.copy(center);
  controls.enableRotate = true;
  controls.update();
  setActiveView("perspective");
}

function setView(name) {
  const { width, length, height } = currentModel.room.dimensions;
  const center = new THREE.Vector3(width / 2, height / 2, length / 2);
  const distance = Math.max(width, length, height) * 2.15;
  camera.up.set(0, 1, 0);
  if (name === "top") {
    camera.position.set(center.x, distance, center.z);
    camera.up.set(0, 0, -1);
  } else if (name === "front") {
    camera.position.set(center.x, center.y, -distance);
  } else if (name === "side") {
    camera.position.set(distance, center.y, center.z);
  } else {
    fitPerspective();
    return;
  }
  controls.target.copy(center);
  controls.enableRotate = false;
  controls.update();
  setActiveView(name);
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

const sampleModels = {
  empty: {
    label: "3×6×3 公尺空房間",
    filename: "P123_EmptyRoom_3x6x3m.json",
    path: "data/P123_EmptyRoom_3x6x3m.json",
    fallback: referenceModel
  },
  obstacle: {
    label: "含大型桌面的引導式房間",
    filename: "P123_GuidedRoom_WithObstacle.json",
    path: "data/P123_GuidedRoom_WithObstacle.json",
    fallback: window.P123_SAMPLE_MODELS?.obstacle
  },
  twoRooms: {
    label: "兩間各3×4×3公尺的雙房間",
    filename: "P123_TwoRooms_Each3x4x3m_WithDoor.json",
    path: "data/P123_TwoRooms_Each3x4x3m_WithDoor.json",
    fallback: window.P123_SAMPLE_MODELS?.twoRooms
  }
};

async function loadSample(key, announce = true) {
  const sample = sampleModels[key];
  if (!sample) throw new Error("找不到指定的範例檔案。");
  let data = sample.fallback ? structuredClone(sample.fallback) : null;
  try {
    const response = await fetch(sample.path, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    if (!data) throw new Error("範例檔案載入失敗。");
  }
  currentSampleKey = key;
  document.querySelector("#sampleSelect").value = key;
  buildModel(data, sample.filename);
  if (announce) showToast(`已載入：${sample.label}`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

document.querySelector("#openButton").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async event => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    buildModel(data, file.name);
    document.querySelector("#sampleSelect").value = "";
    showToast(`已開啟 ${file.name}`);
  } catch (error) {
    showToast(`無法開啟：${error.message}`);
  } finally {
    fileInput.value = "";
  }
});

document.querySelector("#sampleSelect").addEventListener("change", async event => {
  try {
    await loadSample(event.target.value);
  } catch (error) {
    showToast(`無法載入：${error.message}`);
  }
});

document.querySelector("#resetButton").addEventListener("click", async () => {
  try {
    await loadSample(currentSampleKey);
  } catch (error) {
    showToast(`無法載入：${error.message}`);
  }
});

document.querySelectorAll(".view-button").forEach(button => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelector("#dimensionToggle").addEventListener("change", event => {
  dimensionGroup.visible = event.target.checked;
});
document.querySelector("#gridToggle").addEventListener("change", event => {
  grid.visible = event.target.checked;
});
document.querySelector("#ceilingToggle").addEventListener("change", event => {
  ceilingMesh.visible = event.target.checked;
});

document.querySelector("#jsonButton").addEventListener("click", () => jsonDialog.showModal());
document.querySelector("#closeDialog").addEventListener("click", () => jsonDialog.close());
document.querySelector("#closeDialogBottom").addEventListener("click", () => jsonDialog.close());
jsonDialog.addEventListener("click", event => {
  if (event.target === jsonDialog) jsonDialog.close();
});

document.querySelector("#downloadJsonButton").addEventListener("click", () => {
  downloadBlob(new Blob([JSON.stringify(currentModel, null, 2)], { type: "application/json" }), currentFilename);
});

document.querySelector("#exportButton").addEventListener("click", async () => {
  try {
    showToast("正在建立 GLB…");
    const exporter = new THREE.GLTFExporter();
    const result = await new Promise((resolve, reject) => {
      exporter.parse(modelGroup, resolve, reject, { binary: true, onlyVisible: true });
    });
    const basename = currentFilename.replace(/\.json$/i, "") || "P123_space";
    downloadBlob(new Blob([result], { type: "model/gltf-binary" }), `${basename}.glb`);
    showToast("GLB 已匯出");
  } catch (error) {
    showToast(`匯出失敗：${error.message}`);
  }
});

new ResizeObserver(resize).observe(viewport);

try {
  buildModel(referenceModel, currentFilename);
  resize();
  animate();
  loading.classList.add("hidden");
} catch (error) {
  loading.classList.add("error");
  loading.innerHTML = `<p>無法啟動觀看器。請確認目前可以連上網際網路後重新整理。<br><small>${error.message}</small></p>`;
}

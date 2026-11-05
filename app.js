"use strict";

const APP_VERSION = "V0.3.0";
const SCHEMA_VERSION = "P123-SPACE-0.2.0";
const WALL_THICKNESS_CM = 10;
const WALL_META = [
  { id: "W001", label: "前牆", start: (w, l) => [w, 0], end: (w, l) => [0, 0], length: (w, l) => w },
  { id: "W002", label: "右牆", start: (w, l) => [w, l], end: (w, l) => [w, 0], length: (w, l) => l },
  { id: "W003", label: "後牆", start: (w, l) => [0, l], end: (w, l) => [w, l], length: (w, l) => w },
  { id: "W004", label: "左牆", start: (w, l) => [0, 0], end: (w, l) => [0, l], length: (w, l) => l }
];
const $ = selector => document.querySelector(selector);
const viewport = $("#viewport");
const loading = $("#loading");
const fileInput = $("#fileInput");
const jsonDialog = $("#jsonDialog");
const toast = $("#toast");

let mode = "builder";
let editor = makeDefaultEditor();
let currentModel = null;
let currentFilename = "P123_ParametricRoom.json";
let modelGroup, dimensionGroup, ceilingMesh, grid, toastTimer, pointerDown;
let selectableMeshes = [];

function makeDefaultEditor() {
  return {
    name: "P123 參數式矩形房間", widthCm: 300, lengthCm: 400, heightCm: 300,
    roomParameterIds: { width: "A001", length: "A002", height: "A003" },
    openings: [], nextParameterNumber: 4, nextOpeningNumber: 1,
    selectedWallId: null, selectedOpeningId: null
  };
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111b);
scene.fog = new THREE.Fog(0x07111b, 18, 50);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
camera.position.set(7.5, 6.5, 8.5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.prepend(renderer.domElement);
const labelRenderer = new THREE.CSS2DRenderer();
labelRenderer.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4";
viewport.append(labelRenderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xb8eaff, 0x17202b, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
keyLight.position.set(4, 9, 5);
scene.add(keyLight);

function cmToM(value) { return Number(value) / 100; }
function pad3(value) { return String(value).padStart(3, "0"); }
function typeLabel(type) { return { door: "門", window: "窗", opening: "一般開口" }[type] || "開口"; }
function wallInfo(id) { return WALL_META.find(wall => wall.id === id); }
function wallLengthCm(id) { const wall = wallInfo(id); return wall ? wall.length(editor.widthCm, editor.lengthCm) : 0; }
function safeFilename(name) { return String(name || "P123_ParametricRoom").replace(/[\\/:*?\"<>|]+/g, "_").trim() || "P123_ParametricRoom"; }
function escapeHtml(value) { return String(value).replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]); }

function validateEditor() {
  const errors = [];
  [["A001 寬度", editor.widthCm], ["A002 長度", editor.lengthCm], ["A003 高度", editor.heightCm]].forEach(item => {
    if (!Number.isFinite(item[1]) || item[1] < 50 || item[1] > 5000) errors.push(item[0] + "須介於 50–5000 cm。");
  });
  editor.openings.forEach(opening => {
    const prefix = opening.id + "：";
    if (!(opening.widthCm > 0) || !(opening.heightCm > 0)) errors.push(prefix + "寬、高必須大於 0。");
    if (opening.leftCm < 0 || opening.bottomCm < 0) errors.push(prefix + "左距、下距不可為負數。");
    if (opening.leftCm + opening.widthCm > wallLengthCm(opening.wallId) + 0.001) errors.push(prefix + "超出牆面寬度。");
    if (opening.bottomCm + opening.heightCm > editor.heightCm + 0.001) errors.push(prefix + "超出牆面高度。");
  });
  editor.openings.forEach((opening, index) => editor.openings.slice(index + 1).forEach(other => {
    if (opening.wallId !== other.wallId) return;
    const separate = opening.leftCm + opening.widthCm <= other.leftCm || other.leftCm + other.widthCm <= opening.leftCm ||
      opening.bottomCm + opening.heightCm <= other.bottomCm || other.bottomCm + other.heightCm <= opening.bottomCm;
    if (!separate) errors.push(opening.id + " 與 " + other.id + " 在同一牆面重疊。");
  }));
  return errors;
}

function editorToModel() {
  const w = cmToM(editor.widthCm), l = cmToM(editor.lengthCm), h = cmToM(editor.heightCm);
  const parameters = [
    { id: "A001", objectId: "R001", property: "width", label: "房間寬度", value: editor.widthCm, unit: "centimeter" },
    { id: "A002", objectId: "R001", property: "length", label: "房間長度", value: editor.lengthCm, unit: "centimeter" },
    { id: "A003", objectId: "R001", property: "height", label: "房間高度", value: editor.heightCm, unit: "centimeter" }
  ];
  editor.openings.forEach(opening => {
    const props = ["width", "height", "left", "bottom"];
    const labels = ["開口寬度", "開口高度", "距牆面左側", "距地板高度"];
    const values = [opening.widthCm, opening.heightCm, opening.leftCm, opening.bottomCm];
    opening.parameterIds.forEach((id, i) => parameters.push({ id, objectId: opening.id, property: props[i], label: labels[i], value: values[i], unit: "centimeter" }));
  });
  return {
    schemaVersion: SCHEMA_VERSION, modelType: "parametric_room_builder", name: editor.name,
    unit: "meter", inputUnit: "centimeter", webVersion: APP_VERSION, sdsVersion: "SBI-P-SDS v3.6",
    coordinateSystem: { handedness: "right", upAxis: "Y", horizontalAxes: ["X", "Z"], origin: "floor_corner_A", description: "X is room width, Y is height, and Z is room length." },
    parametric: { template: "rectangle", roomId: "R001", nextParameterNumber: editor.nextParameterNumber, nextOpeningNumber: editor.nextOpeningNumber },
    room: { id: "R001", shape: "rectangular_prism", dimensions: { width: w, length: l, height: h }, parameterIds: editor.roomParameterIds,
      floorPolygon: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: l }, { x: 0, z: l }], floorElevation: 0, ceilingElevation: h },
    walls: WALL_META.map(meta => {
      const start = meta.start(w, l), end = meta.end(w, l);
      return { id: meta.id, label: meta.label, start: { x: start[0], y: 0, z: start[1] }, end: { x: end[0], y: 0, z: end[1] }, height: h, thickness: cmToM(WALL_THICKNESS_CM) };
    }),
    openings: editor.openings.map(opening => ({
      id: opening.id, type: opening.type, label: typeLabel(opening.type) + " " + opening.id, hostWallId: opening.wallId,
      width: cmToM(opening.widthCm), height: cmToM(opening.heightCm), left: cmToM(opening.leftCm), bottom: cmToM(opening.bottomCm),
      parameterIds: { width: opening.parameterIds[0], height: opening.parameterIds[1], left: opening.parameterIds[2], bottom: opening.parameterIds[3] }
    })),
    obstacles: [], parameters,
    measurements: [
      { id: "M001", type: "room_width", value: w, unit: "meter", parameterId: "A001" },
      { id: "M002", type: "room_length", value: l, unit: "meter", parameterId: "A002" },
      { id: "M003", type: "room_height", value: h, unit: "meter", parameterId: "A003" }
    ],
    quality: { status: "user_parametric_model", geometryConfidence: 1, notes: "Rectangle room and rectangular openings generated from user-entered centimeter parameters." }
  };
}

function parseParametricModel(data) {
  if (!data || data.modelType !== "parametric_room_builder" || !data.room || !data.room.dimensions) return null;
  const value = (objectId, property, fallback) => {
    const item = (data.parameters || []).find(parameter => parameter.objectId === objectId && parameter.property === property);
    return item && Number.isFinite(Number(item.value)) ? Number(item.value) : fallback;
  };
  const result = makeDefaultEditor();
  result.name = data.name || result.name;
  result.widthCm = value("R001", "width", Number(data.room.dimensions.width) * 100);
  result.lengthCm = value("R001", "length", Number(data.room.dimensions.length) * 100);
  result.heightCm = value("R001", "height", Number(data.room.dimensions.height) * 100);
  result.openings = (data.openings || []).map((opening, index) => {
    const ids = opening.parameterIds || {}, objectId = opening.id || "O" + pad3(index + 1);
    return { id: objectId, type: opening.type || "opening", wallId: opening.hostWallId,
      widthCm: value(objectId, "width", Number(opening.width) * 100), heightCm: value(objectId, "height", Number(opening.height) * 100),
      leftCm: value(objectId, "left", Number(opening.left || 0) * 100), bottomCm: value(objectId, "bottom", Number(opening.bottom || opening.sillHeight || 0) * 100),
      parameterIds: [ids.width, ids.height, ids.left, ids.bottom].map((id, i) => id || "A" + pad3(4 + index * 4 + i)) };
  });
  const largestA = (data.parameters || []).reduce((max, item) => Math.max(max, Number(String(item.id || "").replace(/^A/, "")) || 0), 3);
  const largestO = result.openings.reduce((max, item) => Math.max(max, Number(item.id.replace(/^O/, "")) || 0), 0);
  result.nextParameterNumber = Math.max(Number(data.parametric && data.parametric.nextParameterNumber) || 0, largestA + 1);
  result.nextOpeningNumber = Math.max(Number(data.parametric && data.parametric.nextOpeningNumber) || 0, largestO + 1);
  return result;
}

function makeMaterial(color, opacity) {
  const alpha = opacity === undefined ? 1 : opacity;
  return new THREE.MeshStandardMaterial({ color, transparent: alpha < 1, opacity: alpha, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide, depthWrite: alpha > 0.35 });
}

function addEdges(mesh, color, opacity) {
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: color || 0x5ccbe0, transparent: true, opacity: opacity === undefined ? 0.7 : opacity })));
}

function disposeObject(object) {
  object.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(item => item.dispose && item.dispose());
  });
  scene.remove(object);
}

function createFloor(data) {
  const shape = new THREE.Shape();
  data.room.floorPolygon.forEach((point, index) => index ? shape.lineTo(point.x, point.z) : shape.moveTo(point.x, point.z));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, makeMaterial(0x172c3a, 0.96));
  mesh.position.y = data.room.floorElevation || 0;
  addEdges(mesh, 0x76dfee, 0.5);
  return mesh;
}

function createCeiling(data) {
  const shape = new THREE.Shape();
  data.room.floorPolygon.forEach((point, index) => index ? shape.lineTo(point.x, point.z) : shape.moveTo(point.x, point.z));
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, makeMaterial(0x6cc8d7, 0.1));
  mesh.position.y = data.room.ceilingElevation || data.room.dimensions.height;
  addEdges(mesh, 0x74d8e9, 0.35);
  return mesh;
}

function placeWallBlock(group, wall, startS, endS, bottom, top, selected) {
  const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
  const total = Math.hypot(dx, dz), width = endS - startS, height = top - bottom;
  if (width <= 0.0001 || height <= 0.0001 || total <= 0) return;
  const ux = dx / total, uz = dz / total, centerS = (startS + endS) / 2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, wall.thickness || 0.1), makeMaterial(selected ? 0x63d9ea : 0x4e91aa, selected ? 0.5 : 0.34));
  mesh.position.set(wall.start.x + ux * centerS, bottom + height / 2, wall.start.z + uz * centerS);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.userData = { p123Type: "wall", objectId: wall.id };
  addEdges(mesh, selected ? 0xa8f5ff : 0x5ccbe0, selected ? 0.95 : 0.62);
  group.add(mesh);
  selectableMeshes.push(mesh);
}

function createParametricWall(wall, openings) {
  const group = new THREE.Group();
  const totalLength = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
  const xCuts = [0, totalLength], yCuts = [0, wall.height];
  openings.forEach(opening => { xCuts.push(opening.left, opening.left + opening.width); yCuts.push(opening.bottom, opening.bottom + opening.height); });
  const unique = values => Array.from(new Set(values.map(value => Number(value.toFixed(6))))).sort((a, b) => a - b);
  const xs = unique(xCuts), ys = unique(yCuts);
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      const mx = (xs[xi] + xs[xi + 1]) / 2, my = (ys[yi] + ys[yi + 1]) / 2;
      const isOpening = openings.some(item => mx > item.left && mx < item.left + item.width && my > item.bottom && my < item.bottom + item.height);
      if (!isOpening) placeWallBlock(group, wall, xs[xi], xs[xi + 1], ys[yi], ys[yi + 1], editor.selectedWallId === wall.id);
    }
  }
  openings.forEach(opening => addOpeningMarker(group, wall, opening));
  return group;
}

function addOpeningMarker(group, wall, opening) {
  const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, total = Math.hypot(dx, dz);
  const ux = dx / total, uz = dz / total, centerS = opening.left + opening.width / 2;
  const selected = editor.selectedOpeningId === opening.id;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opening.width, opening.height), new THREE.MeshBasicMaterial({
    color: selected ? 0xffcf68 : opening.type === "window" ? 0x74dff2 : 0x8ce7bd, transparent: true,
    opacity: selected ? 0.34 : 0.17, side: THREE.DoubleSide, depthWrite: false
  }));
  mesh.position.set(wall.start.x + ux * centerS, opening.bottom + opening.height / 2, wall.start.z + uz * centerS);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.translateZ((wall.thickness || 0.1) / 2 + 0.003);
  mesh.userData = { p123Type: "opening", objectId: opening.id, wallId: wall.id };
  addEdges(mesh, selected ? 0xffde89 : 0xb8f6ff, selected ? 1 : 0.78);
  group.add(mesh);
  selectableMeshes.push(mesh);
}

function createLegacyWall(wall, defaultHeight) {
  const group = new THREE.Group();
  const normalized = { id: wall.id, start: wall.start, end: wall.end, height: wall.height || defaultHeight, thickness: wall.thickness || 0.1 };
  placeWallBlock(group, normalized, 0, Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z), 0, normalized.height, false);
  return group;
}

function createObstacle(obstacle) {
  const size = obstacle.size || {}, position = obstacle.position || {};
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.width || 1, size.height || 1, size.depth || 1), makeMaterial(0xd88f4d, 0.58));
  mesh.position.set(position.x || 0, position.y || (size.height || 1) / 2, position.z || 0);
  mesh.rotation.y = obstacle.rotationY || 0;
  addEdges(mesh, 0xffc27d, 0.8);
  return mesh;
}

function dimensionLabel(text, position) {
  const element = document.createElement("div");
  element.className = "dimension-label";
  element.textContent = text;
  const label = new THREE.CSS2DObject(element);
  label.position.copy(position);
  return label;
}

function createDimensions(data) {
  const group = new THREE.Group(), d = data.room.dimensions;
  group.add(dimensionLabel(d.width.toFixed(2) + " m", new THREE.Vector3(d.width / 2, 0.16, -0.28)));
  group.add(dimensionLabel(d.length.toFixed(2) + " m", new THREE.Vector3(d.width + 0.28, 0.16, d.length / 2)));
  group.add(dimensionLabel(d.height.toFixed(2) + " m", new THREE.Vector3(-0.25, d.height / 2, 0)));
  return group;
}

function validateLegacy(data) {
  if (!data || !data.room || !data.room.dimensions) throw new Error("缺少 room.dimensions。");
  const d = data.room.dimensions;
  if (![d.width, d.length, d.height].every(value => Number.isFinite(Number(value)) && Number(value) > 0)) throw new Error("房間寬、長、高必須為正數。");
  if (!Array.isArray(data.room.floorPolygon) || data.room.floorPolygon.length < 3) throw new Error("floorPolygon 至少需要三個頂點。");
  if (!Array.isArray(data.walls)) throw new Error("缺少 walls 陣列。");
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.z - next.x * point.z; }, 0) / 2);
}

function rebuild(data, resetCamera) {
  validateLegacy(data);
  if (modelGroup) disposeObject(modelGroup);
  if (dimensionGroup) disposeObject(dimensionGroup);
  if (grid) scene.remove(grid);
  selectableMeshes = [];
  modelGroup = new THREE.Group();
  modelGroup.add(createFloor(data));
  ceilingMesh = createCeiling(data);
  ceilingMesh.visible = $("#ceilingToggle").checked;
  modelGroup.add(ceilingMesh);
  const parametric = data.modelType === "parametric_room_builder";
  (data.walls || []).forEach(wall => {
    const wallOpenings = parametric ? (data.openings || []).filter(item => item.hostWallId === wall.id) : [];
    modelGroup.add(parametric ? createParametricWall(wall, wallOpenings) : createLegacyWall(wall, data.room.dimensions.height));
  });
  (data.obstacles || []).forEach(item => modelGroup.add(createObstacle(item)));
  scene.add(modelGroup);
  dimensionGroup = createDimensions(data);
  dimensionGroup.visible = $("#dimensionToggle").checked;
  scene.add(dimensionGroup);
  const size = Math.max(data.room.dimensions.width, data.room.dimensions.length, 4);
  grid = new THREE.GridHelper(Math.ceil(size * 2.2), Math.ceil(size * 2.2), 0x4b9ab3, 0x1c3a49);
  grid.position.set(data.room.dimensions.width / 2, -0.012, data.room.dimensions.length / 2);
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  grid.visible = $("#gridToggle").checked;
  scene.add(grid);
  currentModel = data;
  updateSummary(data);
  $("#jsonContent").textContent = JSON.stringify(data, null, 2);
  if (resetCamera) fitCamera(data);
}

function fitCamera(data) {
  if (!data) return;
  const d = data.room.dimensions, center = new THREE.Vector3(d.width / 2, d.height * 0.42, d.length / 2), span = Math.max(d.width, d.length, d.height, 3);
  controls.target.copy(center);
  camera.position.set(center.x + span * 1.25, center.y + span * 0.9, center.z + span * 1.35);
  camera.near = Math.max(span / 1000, 0.01);
  camera.far = span * 30;
  camera.updateProjectionMatrix();
  controls.update();
}

function updateSummary(data) {
  const d = data.room.dimensions;
  $("#spaceName").textContent = data.name || "未命名空間";
  $("#schemaVersion").textContent = data.schemaVersion || "未標示版本";
  $("#widthValue").textContent = Number(d.width).toFixed(2);
  $("#lengthValue").textContent = Number(d.length).toFixed(2);
  $("#heightValue").textContent = Number(d.height).toFixed(2);
  $("#areaValue").textContent = polygonArea(data.room.floorPolygon).toFixed(2);
  $("#wallCount").textContent = (data.walls || []).length;
  $("#openingCount").textContent = (data.openings || []).length;
  $("#obstacleCount").textContent = (data.obstacles || []).length;
  $("#originValue").textContent = data.coordinateSystem && data.coordinateSystem.origin || "—";
  $("#unitBadge").textContent = data.unit || "meter";
  $("#qualityNote").textContent = data.quality && data.quality.notes || "未提供品質說明。";
}

function parameterRow(id, label, value, field) {
  return "<label class=\"parameter-row\"><span class=\"parameter-id\">" + id + "</span><span class=\"parameter-label\">" + label + "</span><input type=\"number\" min=\"0\" step=\"1\" value=\"" + value + "\" data-field=\"" + field + "\" aria-label=\"" + id + " " + label + "，單位公分\"><span class=\"parameter-unit\">cm</span></label>";
}

function renderBuilder(resetCamera) {
  mode = "builder";
  const errors = validateEditor();
  renderBuilderPanels();
  if (errors.length) {
    $("#validationBanner").hidden = false;
    $("#validationBanner").innerHTML = "<strong>請修正參數</strong><ul>" + errors.map(error => "<li>" + escapeHtml(error) + "</li>").join("") + "</ul>";
    $("#modelStatus").textContent = "參數有誤 · 保留上次模型";
    return false;
  }
  $("#validationBanner").hidden = true;
  $("#modelStatus").textContent = "建模模式 · 即時更新";
  currentModel = editorToModel();
  currentFilename = safeFilename(editor.name) + ".json";
  rebuild(currentModel, resetCamera);
  return true;
}

function renderBuilderPanels() {
  $("#roomParameterTable").innerHTML = [
    parameterRow("A001", "寬度", editor.widthCm, "room-width"),
    parameterRow("A002", "長度", editor.lengthCm, "room-length"),
    parameterRow("A003", "高度", editor.heightCm, "room-height")
  ].join("");
  $("#roomParameterTable").querySelectorAll("input").forEach(input => input.addEventListener("change", handleRoomInput));
  $("#wallList").innerHTML = WALL_META.map(wall => {
    const selected = editor.selectedWallId === wall.id ? " selected" : "";
    return "<button class=\"component-item" + selected + "\" type=\"button\" data-wall-id=\"" + wall.id + "\"><span><strong>" + wall.id + "</strong><small>" + wall.label + "</small></span><em>" + wallLengthCm(wall.id) + " cm</em></button>";
  }).join("");
  $("#wallList").querySelectorAll("[data-wall-id]").forEach(button => button.addEventListener("click", () => selectWall(button.dataset.wallId)));
  const selectedWall = wallInfo(editor.selectedWallId);
  $("#selectedWallBadge").textContent = selectedWall ? selectedWall.id : "尚未選取";
  $("#addOpeningButton").disabled = !selectedWall;
  $("#builderModeNote").textContent = selectedWall ? "新開口會加入「" + selectedWall.label + "」。" : "請先選取牆面。";
  $("#openingListCount").textContent = String(editor.openings.length);
  if (!editor.openings.length) {
    $("#openingList").className = "component-list empty-list";
    $("#openingList").textContent = "尚無開口";
  } else {
    $("#openingList").className = "component-list";
    $("#openingList").innerHTML = editor.openings.map(opening => {
      const selected = editor.selectedOpeningId === opening.id ? " selected opening" : " opening";
      return "<button class=\"component-item" + selected + "\" type=\"button\" data-opening-id=\"" + opening.id + "\"><span><strong>" + opening.id + "</strong><small>" + typeLabel(opening.type) + " · " + opening.wallId + "</small></span><em>" + opening.widthCm + "×" + opening.heightCm + "</em></button>";
    }).join("");
    $("#openingList").querySelectorAll("[data-opening-id]").forEach(button => button.addEventListener("click", () => selectOpening(button.dataset.openingId)));
  }
  const opening = editor.openings.find(item => item.id === editor.selectedOpeningId);
  $("#openingParameterSection").hidden = !opening;
  if (opening) {
    $("#openingParameterTitle").textContent = opening.id + " · " + typeLabel(opening.type);
    const fields = [
      [opening.parameterIds[0], "寬度", opening.widthCm, "widthCm"],
      [opening.parameterIds[1], "高度", opening.heightCm, "heightCm"],
      [opening.parameterIds[2], "左距", opening.leftCm, "leftCm"],
      [opening.parameterIds[3], "下距", opening.bottomCm, "bottomCm"]
    ];
    $("#openingParameterTable").innerHTML = fields.map(item => parameterRow(item[0], item[1], item[2], item[3])).join("");
    $("#openingParameterTable").querySelectorAll("input").forEach(input => input.addEventListener("change", handleOpeningInput));
  }
}

function handleRoomInput(event) {
  const map = { "room-width": "widthCm", "room-length": "lengthCm", "room-height": "heightCm" };
  editor[map[event.target.dataset.field]] = Number(event.target.value);
  renderBuilder(false);
}

function handleOpeningInput(event) {
  const opening = editor.openings.find(item => item.id === editor.selectedOpeningId);
  if (!opening) return;
  opening[event.target.dataset.field] = Number(event.target.value);
  renderBuilder(false);
}

function selectWall(id) {
  editor.selectedWallId = id;
  editor.selectedOpeningId = null;
  renderBuilder(false);
}

function selectOpening(id) {
  const opening = editor.openings.find(item => item.id === id);
  if (!opening) return;
  editor.selectedOpeningId = id;
  editor.selectedWallId = opening.wallId;
  renderBuilder(false);
}

function addOpening() {
  if (!editor.selectedWallId) return;
  const type = $("#openingType").value, hostLength = wallLengthCm(editor.selectedWallId);
  const defaults = type === "window" ? [120, 120, 90] : type === "door" ? [90, 210, 0] : [100, 200, 0];
  const width = Math.min(defaults[0], Math.max(20, hostLength - 20));
  const height = Math.min(defaults[1], Math.max(20, editor.heightCm - defaults[2]));
  const opening = {
    id: "O" + pad3(editor.nextOpeningNumber++), type, wallId: editor.selectedWallId,
    widthCm: width, heightCm: height, leftCm: Math.max(0, Math.round((hostLength - width) / 2)), bottomCm: defaults[2],
    parameterIds: [0, 1, 2, 3].map(() => "A" + pad3(editor.nextParameterNumber++))
  };
  editor.openings.push(opening);
  editor.selectedOpeningId = opening.id;
  renderBuilder(false);
  showToast("已新增" + typeLabel(type) + " " + opening.id + "，並產生 " + opening.parameterIds.join("、"));
}

function deleteSelectedOpening() {
  const opening = editor.openings.find(item => item.id === editor.selectedOpeningId);
  if (!opening) return;
  editor.openings = editor.openings.filter(item => item.id !== opening.id);
  editor.selectedOpeningId = null;
  renderBuilder(false);
  showToast("已刪除 " + opening.id);
}

function showLegacy(data, filename) {
  mode = "viewer";
  currentFilename = filename || "P123_space.json";
  $("#validationBanner").hidden = true;
  $("#modelStatus").textContent = "範例檢視模式";
  $("#roomParameterTable").innerHTML = "<p class=\"readonly-note\">此檔案使用舊版或複合空間格式，可檢視與匯出；若要編輯參數，請按「新建矩形房間」。</p>";
  $("#wallList").innerHTML = (data.walls || []).map(wall => "<div class=\"component-item readonly\"><span><strong>" + escapeHtml(wall.id || "—") + "</strong><small>" + escapeHtml(wall.label || "牆面") + "</small></span></div>").join("");
  $("#selectedWallBadge").textContent = "唯讀";
  $("#addOpeningButton").disabled = true;
  $("#builderModeNote").textContent = "舊版範例保留原始資料，不會被改寫。";
  $("#openingParameterSection").hidden = true;
  $("#openingListCount").textContent = String((data.openings || []).length);
  $("#openingList").className = "component-list" + ((data.openings || []).length ? "" : " empty-list");
  $("#openingList").innerHTML = (data.openings || []).length ? (data.openings || []).map(item => "<div class=\"component-item readonly\"><span><strong>" + escapeHtml(item.id || "—") + "</strong><small>" + escapeHtml(typeLabel(item.type)) + "</small></span></div>").join("") : "尚無開口";
  rebuild(data, true);
}

function openData(data, filename) {
  const parsed = parseParametricModel(data);
  if (parsed) {
    editor = parsed;
    currentFilename = filename || "P123_ParametricRoom.json";
    renderBuilder(true);
  } else {
    validateLegacy(data);
    showLegacy(data, filename);
  }
}

const sampleModels = {
  parametric: { label: "參數式房間（含門與窗）", filename: "P123_ParametricRoom_3x4x3m_WithDoorWindow.json", path: "data/P123_ParametricRoom_3x4x3m_WithDoorWindow.json", fallback: makeParametricSample() },
  empty: { label: "空房間 3×6×3 m", filename: "P123_EmptyRoom_3x6x3m.json", path: "data/P123_EmptyRoom_3x6x3m.json", fallback: null },
  obstacle: { label: "引導式房間（含大型桌面）", filename: "P123_GuidedRoom_WithObstacle.json", path: "data/P123_GuidedRoom_WithObstacle.json", fallback: window.P123_SAMPLE_MODELS && window.P123_SAMPLE_MODELS.obstacle },
  twoRooms: { label: "雙房間（各 3×4×3 m）", filename: "P123_TwoRooms_Each3x4x3m_WithDoor.json", path: "data/P123_TwoRooms_Each3x4x3m_WithDoor.json", fallback: window.P123_SAMPLE_MODELS && window.P123_SAMPLE_MODELS.twoRooms }
};

async function loadSample(key) {
  const sample = sampleModels[key];
  if (!sample) return;
  let data = sample.fallback ? structuredClone(sample.fallback) : null;
  try {
    const response = await fetch(sample.path, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    data = await response.json();
  } catch (error) {
    if (!data && key === "empty") data = makeLegacyEmpty();
    if (!data) throw new Error("範例檔案載入失敗。");
  }
  openData(data, sample.filename);
  showToast("已載入：" + sample.label);
}

function makeParametricSample() {
  const savedEditor = editor;
  editor = makeDefaultEditor();
  editor.name = "P123 參數式房間 3x4x3m（含門與窗）";
  editor.openings = [
    { id: "O001", type: "door", wallId: "W001", widthCm: 90, heightCm: 210, leftCm: 105, bottomCm: 0, parameterIds: ["A004", "A005", "A006", "A007"] },
    { id: "O002", type: "window", wallId: "W002", widthCm: 120, heightCm: 120, leftCm: 140, bottomCm: 90, parameterIds: ["A008", "A009", "A010", "A011"] }
  ];
  editor.nextParameterNumber = 12;
  editor.nextOpeningNumber = 3;
  const sample = editorToModel();
  editor = savedEditor;
  return sample;
}

function makeLegacyEmpty() {
  const w = 3, l = 6, h = 3;
  return {
    schemaVersion: "P123-SPACE-0.1.0", modelType: "parametric_indoor_space", name: "P123 Empty Room 3x6x3m", unit: "meter",
    coordinateSystem: { handedness: "right", upAxis: "Y", horizontalAxes: ["X", "Z"], origin: "floor_corner_A" },
    room: { shape: "rectangular_prism", dimensions: { width: w, length: l, height: h }, floorPolygon: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: l }, { x: 0, z: l }], floorElevation: 0, ceilingElevation: h },
    walls: [
      { id: "W01", label: "Wall A", start: { x: 0, y: 0, z: 0 }, end: { x: w, y: 0, z: 0 }, height: h, thickness: 0.1 },
      { id: "W02", label: "Wall B", start: { x: w, y: 0, z: 0 }, end: { x: w, y: 0, z: l }, height: h, thickness: 0.1 },
      { id: "W03", label: "Wall C", start: { x: w, y: 0, z: l }, end: { x: 0, y: 0, z: l }, height: h, thickness: 0.1 },
      { id: "W04", label: "Wall D", start: { x: 0, y: 0, z: l }, end: { x: 0, y: 0, z: 0 }, height: h, thickness: 0.1 }
    ], openings: [], obstacles: [], quality: { notes: "Manually defined empty rectangular room for viewer testing." }
  };
}

function setView(name) {
  if (!currentModel) return;
  const d = currentModel.room.dimensions, center = new THREE.Vector3(d.width / 2, d.height / 2, d.length / 2), span = Math.max(d.width, d.length, d.height, 3) * 1.5;
  controls.target.copy(center);
  if (name === "top") camera.position.set(center.x, center.y + span, center.z + 0.001);
  else if (name === "front") camera.position.set(center.x, center.y, center.z - span);
  else if (name === "side") camera.position.set(center.x + span, center.y, center.z);
  else camera.position.set(center.x + span * 0.85, center.y + span * 0.6, center.z + span * 0.9);
  camera.lookAt(center);
  controls.update();
  document.querySelectorAll(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === name));
}

function resize() {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

renderer.domElement.addEventListener("pointerdown", event => { pointerDown = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener("pointerup", event => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5 || mode !== "builder") return;
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(selectableMeshes, false)[0];
  if (!hit) return;
  if (hit.object.userData.p123Type === "opening") selectOpening(hit.object.userData.objectId);
  else if (hit.object.userData.p123Type === "wall") selectWall(hit.object.userData.objectId);
});

$("#newRoomButton").addEventListener("click", () => {
  editor = makeDefaultEditor();
  $("#sampleSelect").value = "";
  renderBuilder(true);
  showToast("已建立 3 × 4 × 3 m 矩形房間");
});
$("#addOpeningButton").addEventListener("click", addOpening);
$("#deleteOpeningButton").addEventListener("click", deleteSelectedOpening);
$("#openButton").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    openData(JSON.parse(await file.text()), file.name);
    $("#sampleSelect").value = "";
    showToast("已開啟 " + file.name);
  } catch (error) { showToast("無法開啟：" + error.message); }
  finally { fileInput.value = ""; }
});
$("#sampleSelect").addEventListener("change", event => loadSample(event.target.value).catch(error => showToast("無法載入：" + error.message)));
$("#resetButton").addEventListener("click", () => fitCamera(currentModel));
document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
$("#dimensionToggle").addEventListener("change", event => { if (dimensionGroup) dimensionGroup.visible = event.target.checked; });
$("#gridToggle").addEventListener("change", event => { if (grid) grid.visible = event.target.checked; });
$("#ceilingToggle").addEventListener("change", event => { if (ceilingMesh) ceilingMesh.visible = event.target.checked; });
$("#jsonButton").addEventListener("click", () => jsonDialog.showModal());
$("#closeDialog").addEventListener("click", () => jsonDialog.close());
$("#closeDialogBottom").addEventListener("click", () => jsonDialog.close());
jsonDialog.addEventListener("click", event => { if (event.target === jsonDialog) jsonDialog.close(); });
$("#downloadJsonButton").addEventListener("click", () => downloadBlob(new Blob([JSON.stringify(currentModel, null, 2)], { type: "application/json" }), currentFilename));
$("#exportButton").addEventListener("click", async () => {
  try {
    showToast("正在建立 GLB…");
    const exporter = new THREE.GLTFExporter();
    const result = await new Promise((resolve, reject) => exporter.parse(modelGroup, resolve, reject, { binary: true, onlyVisible: true }));
    downloadBlob(new Blob([result], { type: "model/gltf-binary" }), currentFilename.replace(/\.json$/i, "") + ".glb");
    showToast("GLB 已匯出");
  } catch (error) { showToast("匯出失敗：" + error.message); }
});

new ResizeObserver(resize).observe(viewport);
try {
  renderBuilder(true);
  resize();
  animate();
  loading.classList.add("hidden");
} catch (error) {
  loading.classList.add("error");
  loading.innerHTML = "<p>無法啟動觀看器。請確認可以連上網際網路後重新整理。<br><small>" + escapeHtml(error.message) + "</small></p>";
}

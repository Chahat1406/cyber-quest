import * as THREE from "three";
import "./style.css";



type MissionId = "phishing" | "usb" | "mfa" | "network";
type ChapterId = 1 | 2 | 3 | 4 | 5;
type MissionStatus = "locked" | "active" | "complete";
type Choice = { label: string; feedback: string; correct: boolean; integrity?: number; xp?: number };
type Interactable = { id: string; label: string; kind: "npc" | "computer" | "object"; position: THREE.Vector3; object: THREE.Object3D; mission?: MissionId; npcName?: string; prompt?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $("game-canvas") as HTMLCanvasElement;
const minimapCanvas = $("minimap-canvas") as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext("2d");
// Keep the game canvas focusable so keyboard input works reliably after starting.
canvas.tabIndex = 0;
canvas.setAttribute("role", "application");
canvas.setAttribute("aria-label", "Cyber Quest game. Use WASD or arrow keys to move, mouse to look, E to interact, Escape to pause.");
const ui = $("game-ui");
const loading = $("loading-screen");
const startModal = $("start-modal");
const dialogueModal = $("dialogue-modal");
const computerModal = $("computer-modal");
const pauseModal = $("pause-modal");
const endingModal = $("ending-modal");
const interactionHint = $("interaction-hint");
const toast = $("toast");

const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x9bc8d7);
scene.fog = new THREE.Fog(0x9bc8d7, 34, 105);
scene.background = new THREE.Color(0x9bc8d7);
scene.fog = new THREE.Fog(0x9bc8d7, 34, 105);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 180);
camera.position.set(0, 6, 10);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

scene.add(new THREE.HemisphereLight(0xc6efff, 0x46533d, 2.0));
const sun = new THREE.DirectionalLight(0xffedc9, 2.5);
sun.position.set(-20, 35, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45; sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
scene.add(sun);
const coreLights = scene.children.filter((child): child is THREE.Light => child instanceof THREE.Light);

const mat = (color: number, roughness = 0.9, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: emissive ? 0.5 : 0 });
const materials = {
  grass: mat(0x609b61), grassLight: mat(0x7ab76a), dirt: mat(0x856044), road: mat(0x3b4b5c), roadLine: mat(0xd8cba1),
  concrete: mat(0xa9b5b4), wallBlue: mat(0x6b8d9f), wallLight: mat(0xc3d0cc), roof: mat(0x344a60),
  glass: new THREE.MeshStandardMaterial({ color: 0x75dcf5, roughness: 0.25, metalness: 0.1, emissive: 0x174d68, emissiveIntensity: 0.45 }),
  darkGlass: mat(0x243d50), neon: new THREE.MeshStandardMaterial({ color: 0x65e7ff, emissive: 0x32cfff, emissiveIntensity: 1.8 }),
  orange: mat(0xe6a45f), white: mat(0xf1eee2), black: mat(0x202d39), skin: mat(0xc99470), pants: mat(0x344a60),
  red: mat(0xc95b64), green: mat(0x65bd8a), purple: mat(0x8b80c9), yellow: mat(0xf0ce74), metal: mat(0x718899)
};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const worldObjects: THREE.Object3D[] = [];
const interactables: Interactable[] = [];
const colliders: THREE.Box3[] = [];
const tempBox = new THREE.Box3();
let player: THREE.Group;
let playerBody: THREE.Mesh;
let playerFacing = Math.PI;
let currentInteractable: Interactable | null = null;
let started = false, paused = false, modalOpen = true, gameEnded = false;
let currentChapter: ChapterId = 1;
let challengeTimer = 0;
let timerInterval = 0;
let rescueSwitches = 0;
let toastTimer = 0;
let soundOn = false;
let audioCtx: AudioContext | null = null;
const keys = new Set<string>();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
const moveDirection = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
let cameraYaw = 0;
let cameraPitch = 0.25;
let dragging = false;
let lastMouseX = 0, lastMouseY = 0;

const saved = (() => {
  try { return JSON.parse(localStorage.getItem("cyber-quest-save") || "null"); } catch { return null; }
})();
const chapterDone = new Set<number>(Array.isArray(saved?.chapterDone) ? saved.chapterDone : []);
const gameState = {
  xp: Number(saved?.xp) || 0,
  integrity: Number.isFinite(saved?.integrity) ? Math.max(0, Math.min(100, saved.integrity)) : 100,
  completed: new Set<MissionId>(Array.isArray(saved?.completed) ? saved.completed : []),
  flags: new Set<string>(Array.isArray(saved?.flags) ? saved.flags : []),
  currentMission: "phishing" as MissionId
};

function saveGame() {
  try { localStorage.setItem("cyber-quest-save", JSON.stringify({ xp: gameState.xp, integrity: gameState.integrity, completed: [...gameState.completed], flags: [...gameState.flags], chapterDone: [...chapterDone], currentChapter })); } catch { /* Private browsing can disable storage; game remains playable. */ }
}
function addBox(parent: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, cast = true, receive = true) {
  const mesh = new THREE.Mesh(boxGeo, material);
  mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = cast; mesh.receiveShadow = receive;
  parent.add(mesh); worldObjects.push(mesh); return mesh;
}
function addCollider(x: number, z: number, w: number, d: number, minY = 0, maxY = 8) {
  colliders.push(new THREE.Box3(new THREE.Vector3(x - w/2, minY, z - d/2), new THREE.Vector3(x + w/2, maxY, z + d/2)));
}
function makeBuilding(x: number, z: number, w: number, d: number, h: number, color: THREE.Material, label: string, accent = 0x65e7ff) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  addBox(g, 0, h/2, 0, w, h, d, color);
  addBox(g, 0, h + .12, 0, w + .3, .25, d + .3, materials.roof);
  addBox(g, 0, h + .28, 0, w * .45, .12, .2, new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2 }));
  for (let yy = 1.4; yy < h - .4; yy += 1.65) {
    for (let xx = -w/2 + 1; xx < w/2 - .3; xx += 1.55) {
      addBox(g, xx, yy, d/2 + .012, .72, .82, .05, materials.glass, false, false);
    }
  }
  addBox(g, 0, .85, d/2 + .04, 1.2, 1.7, .12, materials.darkGlass, false, false);
  addBox(g, 0, h + .8, d/2 + .13, Math.min(w * .8, 5.5), .65, .12, new THREE.MeshStandardMaterial({ color: 0x0b2232, emissive: 0x06131e }), false, false);
  const sign = addBox(g, 0, h + .8, d/2 + .205, Math.min(w * .78, 5.1), .45, .05, new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .7 }), false, false);
  sign.userData.label = label;
  addCollider(x, z, w + .3, d + .3, 0, h + 1);
  return g;
}
function makeTree(x: number, z: number) {
  addBox(scene, x, .8, z, .42, 1.6, .42, materials.dirt);
  addBox(scene, x, 2.1, z, 1.8, 1.7, 1.8, materials.green);
  addBox(scene, x - .3, 2.7, z + .15, 1.15, 1.15, 1.15, materials.grassLight);
  addCollider(x, z, .8, .8, 0, 3.5);
}
function makeLamp(x: number, z: number) {
  addBox(scene, x, 1.8, z, .13, 3.6, .13, materials.metal);
  addBox(scene, x, 3.7, z, .6, .18, .3, materials.neon);
  const light = new THREE.PointLight(0x65e7ff, 1.2, 8); light.position.set(x, 3.4, z); scene.add(light);
}
function makePerson(name: string, x: number, z: number, shirt: THREE.Material, role: string, id: string, mission?: MissionId) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  addBox(g, 0, .95, 0, .55, .8, .34, shirt);
  addBox(g, 0, 1.58, 0, .46, .45, .42, materials.skin);
  addBox(g, 0, 1.83, -.015, .5, .14, .46, materials.black);
  addBox(g, -.15, .3, 0, .18, .6, .2, materials.pants);
  addBox(g, .15, .3, 0, .18, .6, .2, materials.pants);
  addBox(g, -.34, .95, 0, .16, .66, .17, shirt);
  addBox(g, .34, .95, 0, .16, .66, .17, shirt);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.55, .035, 6, 20), materials.neon);
  halo.rotation.x = Math.PI/2; halo.position.y = 2.18; g.add(halo);
  const marker = new THREE.Group(); marker.position.y = 2.65; g.add(marker);
  addBox(marker, 0, .16, 0, .13, .13, .13, materials.neon);
  const it = { id, label: `Talk to ${name}`, kind: "npc" as const, position: new THREE.Vector3(x, 0, z), object: g, mission, npcName: name, prompt: role };
  interactables.push(it);
  return g;
}
function makeComputer(x: number, z: number, mission: MissionId, label: string) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  addBox(g, 0, .62, 0, 1.3, .12, .7, materials.dirt);
  addBox(g, 0, 1.15, -.15, .75, .95, .1, materials.black);
  addBox(g, 0, 1.16, -.09, .63, .76, .025, materials.glass, false, false);
  addBox(g, 0, .78, -.1, .12, .22, .12, materials.metal);
  addBox(g, 0, .69, -.1, .42, .07, .25, materials.metal);
  addBox(g, 0, .7, .34, .7, .035, .24, materials.white);
  const indicator = addBox(g, 0, 1.16, -.06, .09, .09, .03, materials.neon, false, false);
  indicator.position.x = -.2;
  const it = { id: `computer-${mission}`, label, kind: "computer" as const, position: new THREE.Vector3(x, 0, z), object: g, mission };
  interactables.push(it);
  return g;
}
function makeGround() {
  addBox(scene, 0, -.35, 0, 120, .7, 120, materials.grass, false);
  // Main street and paths.
  addBox(scene, 0, .015, 0, 15, .08, 100, materials.road, false);
  addBox(scene, 0, .065, 0, .13, .025, 100, materials.roadLine, false, false);
  addBox(scene, 0, .02, -20, 78, .08, 9, materials.road, false);
  addBox(scene, 0, .07, -20, 70, .025, .12, materials.roadLine, false, false);
  addBox(scene, 0, .02, 20, 78, .08, 9, materials.road, false);
  // Sidewalks.
  for (const z of [-5.1, 5.1, -24.7, -15.3, 15.3, 24.7]) addBox(scene, 0, .06, z, 80, .12, .45, materials.concrete, false);
  for (let x=-34; x<=34; x+=8) { addBox(scene,x,.08,-20, .08,.02,6,materials.roadLine,false,false); addBox(scene,x,.08,20,.08,.02,6,materials.roadLine,false,false); }
  // Small grass blocks create a deliberately voxel landscape.
  for (let i=0;i<150;i++) {
    const x = (Math.random()-.5)*100, z=(Math.random()-.5)*100;
    if (Math.abs(x)<9 || Math.abs(z+20)<6 || Math.abs(z-20)<6 || (Math.abs(x)<24 && Math.abs(z)<10)) continue;
    addBox(scene,x,.08,z,.35+Math.random()*.65,.18,.35+Math.random()*.65,Math.random()>.5?materials.grassLight:materials.grass,false,false);
  }
}
function buildWorld() {
  makeGround();
  // Landmarks arranged around a walkable street grid.
  makeBuilding(-17,-12,13,10,7.2,materials.wallLight,"CAMPUS",0x65e7ff);
  makeBuilding(18,-12,12,10,9,materials.wallBlue,"TECH HUB",0x7fffc4);
  makeBuilding(-19,12,12,10,6.4,materials.wallBlue,"COMMUNITY",0x8b80c9);
  makeBuilding(18,12,13,10,8,materials.wallLight,"CYBER LAB",0x65e7ff);
  makeBuilding(-34,-32,12,11,8,materials.wallBlue,"LIBRARY",0x7fffc4);
  makeBuilding(34,31,12,11,10,materials.wallLight,"NETWORK OPS",0xffce75);
  for (const [x,z] of [[-31,-5],[-29,5],[-30,25],[-7,29],[8,29],[30,5],[31,-4],[7,-30],[-8,-30],[31,-26],[-32,33]] as number[][]) makeTree(x,z);
  for (const [x,z] of [[-7,-7],[7,-7],[-7,7],[7,7],[-27,-20],[27,-20],[-27,20],[27,20]] as number[][]) makeLamp(x,z);
  // Small kiosks and a bench.
  addBox(scene,-9,.45,-12,2.8,.9,1.2,materials.orange);
  addBox(scene,-9,1.02,-12,2.5,.18,1.05,materials.white);
  addBox(scene,9,.4,12,2.6,.8,.6,materials.dirt);
  addBox(scene,9,.82,12,2.7,.08,.65,materials.orange);
  // Mission characters and workstation.
  makePerson("Maya",-9,-5,materials.purple,"Student • knows about the suspicious email","maya","phishing");
  makePerson("Ravi",-8,17,materials.orange,"Lab assistant • found an unknown USB drive","ravi","usb");
  makePerson("Nia",9,-4.2,materials.green,"Security mentor • account protection specialist","nia","mfa");
  makePerson("Officer Chen",27,24,materials.wallBlue,"Campus security • incident response","chen");
  makeComputer(-14,-5,"phishing","Inspect the suspicious email");
  makeComputer(-12,17,"usb","Inspect the found USB drive");
  makeComputer(13,-5.2,"mfa","Secure the training account");
  makeComputer(30,24,"network","Route the secure network");
  // Small floating wayfinding signposts.
  for (const [x,z,material] of [[-10,-3,materials.neon],[-10,19,materials.yellow],[11,-18,materials.green]] as [number,number,THREE.Material][]) {
    addBox(scene,x,.85,z,.08,1.7,.08,materials.metal);
    addBox(scene,x,1.7,z,.65,.18,.1,material);
  }
}
const chapterInfo = [
  {name:"The Suspicious Signal",map:"Digital College Campus",bg:0x9bc8d7,ground:0x609b61,accent:0x65e7ff},
  {name:"The Hidden Intruder",map:"Abandoned Data City",bg:0x17142c,ground:0x29263f,accent:0xb28cff},
  {name:"Network Under Attack",map:"Firewall Fortress",bg:0x25121d,ground:0x3b202b,accent:0xff7185},
  {name:"The Data Heist",map:"The Lost Data Vault",bg:0x10212d,ground:0x203b4b,accent:0x7fffc4},
  {name:"Digital Guardian",map:"Core of CYBERGATE",bg:0x100b20,ground:0x241c3f,accent:0xffce75}
];
function addChallengeConsole(x:number,z:number,label:string){
  const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
  addBox(g,0,.65,0,1.5,1.3,.8,materials.black);
  addBox(g,0,1.05,.42,1.12,.65,.04,materials.neon,false,false);
  addBox(g,0,.18,.05,1.8,.2,1.1,materials.metal);
  const it:Interactable={id:`challenge-${currentChapter}`,label:`Activate ${label}`,kind:"object",position:new THREE.Vector3(x,0,z),object:g,prompt:"chapter-challenge"};
  interactables.push(it);
}
function buildChapterMap(chapter:ChapterId){
  // Remove the previous level while preserving the scene's lights.
  for(const child of [...scene.children]) if(!coreLights.includes(child as THREE.Light)) scene.remove(child);
  worldObjects.splice(0);interactables.splice(0);colliders.splice(0);
  currentChapter=chapter; gameEnded=false; paused=false; cameraYaw=0; cameraPitch=.25;
  const miniLabel = $("minimap-chapter"); if (miniLabel) miniLabel.textContent = `0${chapter} / ${chapterInfo[chapter-1].map.toUpperCase()}`;
  const info=chapterInfo[chapter-1];
  // scene.background = new THREE.Color(info.bg);
  scene.background=new THREE.Color(info.bg);
  scene.fog=new THREE.Fog(info.bg,28,100);
  if(chapter===1){buildWorld();}
  else {
    const groundMat=mat(info.ground,.95);addBox(scene,0,-.4,0,120,.8,120,groundMat,false);
    // Unique skyline and geometry for each digital world.
    for(let i=0;i<9;i++){
      const x=(i%3-1)*28, z=(Math.floor(i/3)-1)*27;
      const h=9+(i*7+chapter*3)%17, w=7+(i%3)*2;
      const towerMat=mat(chapter===2?0x302b52:chapter===3?0x522a39:chapter===4?0x1d4650:0x38244e,.55,info.accent);
      addBox(scene,x,h/2,z,w,h,w,towerMat);
      addBox(scene,x,h+.2,z,w+.7,.35,w+.7,new THREE.MeshStandardMaterial({color:info.accent,emissive:info.accent,emissiveIntensity:.9}));
      for(let y=2;y<h-1;y+=2.5)addBox(scene,x,y,z+w/2+.02,w*.65,.35,.06,materials.neon,false,false);
      addBox(scene,x,.05,z,w+1,.12,w+1,materials.road,false,false);
    }
    // Bright path and portals make the level navigable.
    addBox(scene,0,.04,0,7,.12,76,materials.road,false,false);
    addBox(scene,0,.12,-26,18,.15,3,materials.neon,false,false);
    addBox(scene,0,3,-31,5,6,.5,new THREE.MeshStandardMaterial({color:info.accent,emissive:info.accent,emissiveIntensity:1.5}),false,false);
    addChallengeConsole(-10,-5,chapter===5?"Rescue Control":"Security Challenge");
    addChallengeConsole(10,7,chapter===5?"Containment Switch":"Evidence Terminal");
    addChallengeConsole(0,24,chapter===5?"Alex's Chamber":"Core Terminal");
    // Decorative data crystals / hazard markers.
    for(let i=0;i<22;i++){const x=(Math.sin(i*4.3))*43,z=(Math.cos(i*2.2))*43;addBox(scene,x,.8,z,.6,1.6,.6,new THREE.MeshStandardMaterial({color:info.accent,emissive:info.accent,emissiveIntensity:.45}),false,false);}
  }
  buildPlayer();player.position.set(0,0,4);camera.position.set(0,6,10);
  document.querySelectorAll<HTMLButtonElement>(".chapter-tab").forEach(b=>{b.classList.toggle("active",Number(b.dataset.chapter)===chapter);b.classList.toggle("complete",chapterDone.has(Number(b.dataset.chapter)));});
  $("mission-title").textContent=chapter===1?"Investigate the Suspicious Signal":info.name;
  $("mission-desc").textContent=chapter===1?"Find Maya near the college entrance and investigate a suspicious message.":`Explore ${info.map}. Find a glowing security terminal and solve the timed challenge.`;
  $("mission-progress").style.width=chapterDone.has(chapter)?"100%":"0%";
  $("mission-count").textContent=`CHAPTER 0${chapter} · ${chapterDone.has(chapter)?"COMPLETE":"0/1"}`;
  $("mission-xp").textContent=`${gameState.xp} XP`;
  saveGame();
  if(chapter>1)showToast(`LOCATION LOADED: ${info.map}. Find a glowing terminal to continue John's rescue mission.`);
  updateHUD();
}
const timedQuestions:{question:string;options:string[];correct:number;feedback:string}[][]=[[],[],[
 {question:"A login alert appears from a country you have never visited. What should you do first?",options:["Approve it to stop alerts","Verify through the official service and secure the account","Send your password to support"],correct:1,feedback:"Correct: verify the alert independently, change compromised credentials if needed, and revoke unknown sessions."},
 {question:"A log shows repeated failed logins followed by one success. What is the safest next step?",options:["Review the event and escalate through the incident process","Delete the logs","Ignore it because login succeeded"],correct:0,feedback:"Preserve logs and follow the incident-response process; don't erase evidence."},
 {question:"A colleague asks you to email a database export to a personal account. What do you do?",options:["Send it quickly","Compress it with no password","Decline and use an approved secure transfer process"],correct:2,feedback:"Sensitive data should only move through approved, access-controlled channels."}], [
 {question:"A workstation may be compromised. Which response is safest?",options:["Isolate it using the approved procedure and report it","Turn off all security controls","Copy its files to your own USB"],correct:0,feedback:"Contain the affected host through approved procedures and preserve evidence."},
 {question:"Which rule best limits unnecessary network access?",options:["Allow every port","Default deny and allow only required traffic","Disable the firewall"],correct:1,feedback:"A least-privilege firewall policy blocks by default and permits required traffic."},
 {question:"You discover an unknown device on a training network. What next?",options:["Give it administrator access","Ignore it","Document it and follow the isolation and investigation procedure"],correct:2,feedback:"Document, verify, and contain unknown devices through the authorized process."}], [
 {question:"A backup request arrives from an unfamiliar account. What should you check?",options:["Identity, authorization, and approved recovery procedures","Only the file name","Nothing if it sounds urgent"],correct:0,feedback:"Validate identity and authorization before accessing or restoring sensitive data."},
 {question:"Why preserve a copy of incident evidence?",options:["To post it online","To support investigation while maintaining integrity","To hide the incident"],correct:1,feedback:"Maintain evidence integrity and restrict access to authorized responders."},
 {question:"A file is encrypted by a suspicious process. What should you do?",options:["Run the file again","Disable backups","Follow incident response and restore from verified clean backups"],correct:2,feedback:"Contain the incident, preserve evidence, and restore from verified clean backups."}], [
 {question:"The Warden asks for Alex's recovery key. What should John do?",options:["Hand it over","Verify the recovery path and use the authorized rescue console","Publish it in chat"],correct:1,feedback:"Use the trusted rescue console and never disclose recovery secrets."},
 {question:"A terminal offers a shortcut that disables all safeguards. Choose:",options:["Reject it and use the verified recovery sequence","Accept it because time is low","Share your access code"],correct:0,feedback:"Do not bypass safeguards; use the approved recovery path."},
 {question:"The final rescue console asks you to confirm Alex's identity. What matters most?",options:["Guess quickly","Trust the Warden's message","Verify against the trusted rescue record"],correct:2,feedback:"Verify identity using a trusted record before releasing access."}]];
function startTimedChallenge(){
  const chapter=currentChapter;
  if(chapterDone.has(chapter)){showDialogue("JOHN",`${chapterInfo[chapter-1].name} is already complete. The access key is saved.`,[{label:"Continue exploring.",action:closeDialogue}],"CHAPTER COMPLETE");return;}
  let seconds=chapter===5?120:chapter===2?25:chapter===3?22:chapter===4?20:30;
  if(chapter===5){rescueSwitches=0;}
  let questionIndex=0;let finished=false;challengeTimer=seconds;
  const modal=$("computer-modal");$("computer-title").textContent=chapter===5?"FINAL RESCUE: ALEX'S CONTAINMENT":"Timed Security Challenge";
  const host=$("computer-content");host.replaceChildren();
  const card=document.createElement("div");card.className="email-card";
  card.innerHTML=`<div class="email-subject">${chapter===5?"CRITICAL ALERT · ALEX'S IDENTITY WILL BE ERASED":"CHAPTER 0"+chapter+" · SIMULATED SECURITY EXERCISE"}</div><div class="email-body">${chapter===5?"You have 120 seconds to answer the security checks and activate all three rescue switches. The timer runs during the challenge.":"Choose the safest security response before the timer expires. This is a fictional offline training simulation."}</div>`;host.appendChild(card);
  const qHost=document.createElement("div");host.appendChild(qHost);
  const timerBox=$("challenge-timer");timerBox.classList.remove("hidden");$("timer-label").textContent=chapter===5?"RESCUE COUNTDOWN":"TIME REMAINING";
  const stopTimer=()=>{if(timerInterval)window.clearInterval(timerInterval);timerInterval=0;timerBox.classList.add("hidden");};
  const end=(success:boolean,message:string)=>{if(finished)return;finished=true;stopTimer();qHost.replaceChildren();const result=document.createElement("div");result.className="feedback-box";result.innerHTML=`<strong>${success?"OBJECTIVE COMPLETE":"TIME EXPIRED"}</strong>${escapeHtml(message)}`;qHost.appendChild(result);const b=document.createElement("button");b.className="primary-btn";b.textContent=success?(chapter===5?"RESCUE ALEX":"RETURN TO THE WORLD") :"RETRY CHALLENGE";b.addEventListener("click",()=>{setModal(modal,false);if(success){chapterDone.add(chapter);gameState.xp+=chapter===5?500:150;saveGame();updateHUD();if(chapter===5){gameEnded=true;showFinalRescueEnding();}else{showToast(`Chapter 0${chapter} complete! +150 XP. Next location unlocked.`);document.querySelectorAll<HTMLButtonElement>(".chapter-tab").forEach(tab=>{tab.disabled=Number(tab.dataset.chapter)>Math.max(1,...chapterDone)+1;});}}else showToast("You can retry the challenge. The story continues when you succeed.");});qHost.appendChild(b);};
  const renderQuestion=()=>{if(finished)return;if(questionIndex>=3){end(true,chapter===5?"Alex is free. The containment system is shutting down.":"You solved the security challenge and recovered the access key.");return;}const q=timedQuestions[chapter][questionIndex];qHost.replaceChildren();const title=document.createElement("p");title.className="email-subject";title.textContent=`CHECK ${questionIndex+1} / 3 — ${q.question}`;qHost.appendChild(title);const choices=document.createElement("div");choices.className="sim-actions";q.options.forEach((option,i)=>{const b=document.createElement("button");b.className="choice-btn";b.textContent=option;b.addEventListener("click",()=>{if(finished)return;if(i===q.correct){gameState.xp+=50;questionIndex++;if(chapter===5)rescueSwitches++;$("mission-xp").textContent=`${gameState.xp} XP`;renderQuestion();}else{gameState.integrity=Math.max(0,gameState.integrity-5);updateHUD();const feedback=document.createElement("p");feedback.className="warning-note";feedback.textContent="Unsafe choice. Try again before the timer runs out.";qHost.appendChild(feedback);}});choices.appendChild(b);});qHost.appendChild(choices);if(chapter===5){const switches=document.createElement("p");switches.className="puzzle-feedback";switches.textContent=`Rescue checks completed: ${rescueSwitches}/3`;qHost.appendChild(switches);}};
  renderQuestion();$("timer-value").textContent=String(challengeTimer);
  if(timerInterval)window.clearInterval(timerInterval);
  timerInterval=window.setInterval(()=>{if(finished)return;challengeTimer--;$("timer-value").textContent=String(challengeTimer);timerBox.classList.toggle("urgent",challengeTimer<=10);if(challengeTimer<=0)end(false,chapter===5?"Alex is still trapped. Retry the rescue sequence and watch the countdown.":"The timer ran out. Review the question and try again.");},1000);
  setModal(modal,true);
}
function showFinalRescueEnding(){
  $("ending-title").textContent="You brought Alex home.";
  $("ending-copy").textContent="The countdown stopped at 00:07. John verified the rescue sequence, opened the containment chamber, and escaped with Alex as CYBERGATE shut down. Some connections can't be broken.";
  $("ending-xp").textContent=String(gameState.xp);$("ending-integrity").textContent=`${gameState.integrity}%`;
  const host=$("ending-lessons");host.replaceChildren();["Verify suspicious messages through trusted channels.","Contain incidents and preserve evidence.","Protect recovery keys and sensitive data.","Never bypass security safeguards under pressure."].forEach((t,i)=>{const row=document.createElement("div");row.className="lesson-item";row.innerHTML=`<b>0${i+1}</b><span>${escapeHtml(t)}</span>`;host.appendChild(row);});
  $("ending-title").textContent="You brought Alex home.";setModal(endingModal,true);
}

function buildPlayer() {
  player = new THREE.Group();
  player.position.set(0,0,2);
  scene.add(player);
  // Simple custom voxel character, no external models required.
  addBox(player,0,1.05,0,.62,.78,.36,mat(0x142f48));
  addBox(player,0,1.63,0,.48,.45,.42,materials.skin);
  addBox(player,0,1.88,-.02,.52,.14,.46,mat(0x1a2431));
  addBox(player,-.34,1.05,0,.17,.65,.18,mat(0x142f48));
  addBox(player,.34,1.05,0,.17,.65,.18,mat(0x142f48));
  addBox(player,-.16,.34,0,.2,.68,.24,materials.pants);
  addBox(player,.16,.34,0,.2,.68,.24,materials.pants);
  addBox(player,-.16,.07,.07,.22,.14,.32,materials.black);
  addBox(player,.16,.07,.07,.22,.14,.32,materials.black);
  addBox(player,0,1.12,.19,.36,.22,.035,materials.neon,false,false);
  playerBody = player.children[0] as THREE.Mesh;
}
function showToast(message: string) {
  toast.textContent = message; toast.classList.add("visible");
  toastTimer = 3.2;
}
function setModal(modal: HTMLElement, open: boolean) {
  modal.classList.toggle("hidden", !open);
  modalOpen = [dialogueModal, computerModal, pauseModal, endingModal, startModal].some(m => !m.classList.contains("hidden"));
  if (open) { keys.clear(); interactionHint.classList.remove("visible"); }
}
function updateHUD() {
  $("xp-value").textContent = String(gameState.xp).padStart(3,"0");
  $("xp-bar").style.width = `${Math.min(100, gameState.xp / 5)}%`;
  $("integrity-value").textContent = `${gameState.integrity}%`;
  $("integrity-bar").style.width = `${gameState.integrity}%`;
  const completed = gameState.completed.size;
  $("mission-xp").textContent = `${gameState.xp} XP`;
  if (currentChapter > 1) {
    const info = chapterInfo[currentChapter - 1];
    $("mission-title").textContent = info.name;
    $("mission-desc").textContent = chapterDone.has(currentChapter) ? `Chapter complete. ${info.map} secured.` : `Explore ${info.map} and find a glowing terminal to solve the timed security challenge.`;
    $("mission-count").textContent = `CHAPTER 0${currentChapter} · ${chapterDone.has(currentChapter) ? "COMPLETE" : "0/1"}`;
    $("mission-progress").style.width = chapterDone.has(currentChapter) ? "100%" : "0%";
    saveGame();
    return;
  }
  $("mission-count").textContent = `CHAPTER 01 · ${completed}/4`;
  $("mission-progress").style.width = `${completed/4*100}%`;
  if (gameState.completed.has("phishing") && !gameState.completed.has("usb")) {
    $("mission-title").textContent = "Secure the Unknown Device";
    $("mission-desc").textContent = "Find Ravi near the community building and investigate the USB drive.";
    gameState.currentMission = "usb";
  } else if (gameState.completed.has("usb") && !gameState.completed.has("mfa")) {
    $("mission-title").textContent = "Protect the Training Account";
    $("mission-desc").textContent = "Meet Nia at the tech hub and secure the account.";
    gameState.currentMission = "mfa";
  } else if (gameState.completed.has("mfa") && !gameState.completed.has("network")) {
    $("mission-title").textContent = "Restore the Secure Route";
    $("mission-desc").textContent = "Find Officer Chen near Network Ops and solve the network-routing challenge.";
    gameState.currentMission = "network";
  } else if (completed === 4) {
    $("mission-title").textContent = "Chapter Complete";
    $("mission-desc").textContent = "You have protected the college district and restored its secure network.";
  } else {
    $("mission-title").textContent = "Investigate the Suspicious Signal";
    $("mission-desc").textContent = "Find Maya near the college entrance and investigate a suspicious message.";
    gameState.currentMission = "phishing";
  }
  saveGame();
}
function completeMission(id: MissionId, xp: number, message: string) {
  if (gameState.completed.has(id)) { showToast("Mission already completed. Explore the district or replay the chapter."); return; }
  gameState.completed.add(id);
  gameState.xp += xp;
  updateHUD();
  showToast(`${message}  +${xp} XP`);
  if (gameState.completed.size === 4) {
    chapterDone.add(1); saveGame();
    window.setTimeout(()=>{showDialogue("JOHN","The campus network is safe, but Alex is still trapped. A portal has opened to the Abandoned Data City. The Warden is waiting deeper inside.",[{label:"Enter Chapter 2 →",action:()=>{closeDialogue();document.querySelectorAll<HTMLButtonElement>(".chapter-tab").forEach(tab=>{tab.disabled=Number(tab.dataset.chapter)>2;});buildChapterMap(2);}}],"CHAPTER 01 COMPLETE · ACCESS KEY ACQUIRED");},700);
  }
}
function showDialogue(name: string, text: string, options: {label:string; action:()=>void}[], tag = "MISSION BRIEFING") {
  $("dialogue-title").textContent = name;
  $("dialogue-text").textContent = text;
  $("dialogue-tag").textContent = tag;
  $("dialogue-avatar").textContent = name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase();
  const host = $("dialogue-options"); host.replaceChildren();
  for (const option of options) {
    const b = document.createElement("button"); b.className = "choice-btn"; b.innerHTML = `<span>${escapeHtml(option.label)}</span><span class="choice-arrow">→</span>`;
    b.addEventListener("click", () => option.action()); host.appendChild(b);
  }
  setModal(dialogueModal, true);
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!)); }
function closeDialogue() { setModal(dialogueModal, false); }
function openComputer(id: MissionId) {
  if (id === "network") { openNetworkPuzzle(); return; }
  if (id === "phishing") openPhishing();
  else if (id === "usb") openUSB();
  else openMFA();
}
function computerShell(title: string, subject: string, sender: string, body: string, warning: string, actions: Choice[], mission: MissionId) {
  $("computer-title").textContent = title;
  const host = $("computer-content"); host.replaceChildren();
  const card = document.createElement("div"); card.className = "email-card";
  card.innerHTML = `<div class="email-subject">${escapeHtml(subject)}</div><div class="email-meta">${escapeHtml(sender)}<br>TO: operator@campus.example<br>TIME: TODAY, 09:41</div><div class="email-body">${body}</div><div class="warning-note">⚠ ${escapeHtml(warning)}</div>`;
  host.appendChild(card);
  const actionHost = document.createElement("div"); actionHost.className = "sim-actions";
  actions.forEach((choice, i) => {
    const b = document.createElement("button"); b.className = "choice-btn"; b.innerHTML = `<span>${escapeHtml(choice.label)}</span><span class="choice-arrow">→</span>`;
    b.addEventListener("click", () => {
      if (gameState.completed.has(mission)) {
        const feedback = document.createElement("div"); feedback.className = "feedback-box";
        feedback.innerHTML = `<strong>MISSION ALREADY COMPLETED</strong>You have already learned this lesson. Close the workstation and continue exploring.`;
        host.appendChild(feedback); actionHost.querySelectorAll("button").forEach(btn => (btn as HTMLButtonElement).disabled = true); return;
      }
      if (gameState.flags.has(`${mission}-decision`)) return;
      gameState.flags.add(`${mission}-decision`);
      gameState.integrity = Math.max(0, Math.min(100, gameState.integrity + (choice.integrity ?? (choice.correct ? 0 : -12))));
      const earned = choice.xp ?? (choice.correct ? 100 : 25);
      gameState.xp += earned;
      saveGame(); updateHUD();
      actionHost.querySelectorAll("button").forEach(btn => (btn as HTMLButtonElement).disabled = true);
      const feedback = document.createElement("div"); feedback.className = "feedback-box";
      feedback.innerHTML = `<strong>${choice.correct ? "SECURE DECISION" : "RISK IDENTIFIED"} · +${earned} XP</strong>${escapeHtml(choice.feedback)}`;
      host.appendChild(feedback);
      const next = document.createElement("button"); next.className = "primary-btn"; next.innerHTML = `CONTINUE MISSION <span>→</span>`;
      next.addEventListener("click", () => {
        setModal(computerModal, false);
        gameState.flags.add(`${mission}-done`);
        completeMission(mission, 0, mission === "phishing" ? "Signal investigated." : mission === "usb" ? "Device handled safely." : "Account secured.");
        if (mission === "phishing") showToast("New objective: meet Ravi by the community building.");
        if (mission === "usb") showToast("New objective: meet Nia near the tech hub.");
        if (mission === "mfa") showToast("All objectives complete. Chapter report unlocked.");
      });
      host.appendChild(next);
    });
    actionHost.appendChild(b);
  });
  host.appendChild(actionHost);
  const timerBox=$("challenge-timer");timerBox.classList.remove("hidden");timerBox.classList.remove("urgent");$("timer-label").textContent="TIME REMAINING";
  let seconds=30;$("timer-value").textContent=String(seconds);
  if(timerInterval)window.clearInterval(timerInterval);
  timerInterval=window.setInterval(()=>{seconds--;$("timer-value").textContent=String(seconds);timerBox.classList.toggle("urgent",seconds<=10);if(seconds<=0){window.clearInterval(timerInterval);timerInterval=0;timerBox.classList.add("hidden");actionHost.querySelectorAll("button").forEach(btn=>(btn as HTMLButtonElement).disabled=true);const timeout=document.createElement("div");timeout.className="warning-note";timeout.textContent="TIME EXPIRED — close and reopen this workstation to retry the question.";host.appendChild(timeout);}},1000);
  actionHost.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{if(timerInterval){window.clearInterval(timerInterval);timerInterval=0;}timerBox.classList.add("hidden");},{once:true}));
  setModal(computerModal, true);
}
function openNetworkPuzzle() {
  if (gameState.completed.has("network")) {
    showDialogue("Officer Chen", "The secure route is restored. The training network is reachable again.", [{ label: "Return to the district.", action: closeDialogue }], "MISSION COMPLETE");
    return;
  }
  if (!gameState.completed.has("mfa")) {
    showDialogue("Officer Chen", "First finish the account-protection mission with Nia. Then we can restore the network route.", [{ label: "I'll secure the account first.", action: closeDialogue }], "NETWORK OPS");
    return;
  }
  $("computer-title").textContent = "Network Ops: restore the secure route";
  const host = $("computer-content"); host.replaceChildren();
  const intro = document.createElement("div"); intro.className = "email-card";
  intro.innerHTML = `<div class="email-subject">INCIDENT CQ-04 · ROUTE ISOLATED</div><div class="email-body">A simulated outage disconnected the campus learning server. Select trusted nodes in the correct order. Avoid the red untrusted node. This puzzle is offline and does not connect to a real network.</div><div class="warning-note">OBJECTIVE: Operator → Gateway → Firewall → Learning Server.</div>`;
  host.appendChild(intro);
  const puzzle = document.createElement("div"); puzzle.className = "network-puzzle";
  puzzle.innerHTML = `<div class="puzzle-status"><span>SECURE ROUTE</span><strong id="route-status">0 / 4 NODES</strong></div><div class="route-nodes" role="group" aria-label="Choose network route nodes"></div><p class="puzzle-feedback" aria-live="polite">Select the nodes in sequence, starting with Operator.</p><button class="primary-btn puzzle-reset" type="button">RESET ROUTE <span>↻</span></button>`;
  host.appendChild(puzzle);
  const nodes = [
    { id: "operator", label: "OPERATOR", symbol: "01", good: true },
    { id: "gateway", label: "GATEWAY", symbol: "02", good: true },
    { id: "firewall", label: "FIREWALL", symbol: "03", good: true },
    { id: "intruder", label: "UNKNOWN NODE", symbol: "×", good: false },
    { id: "server", label: "LEARNING SERVER", symbol: "04", good: true }
  ];
  const correct = ["operator", "gateway", "firewall", "server"];
  const nodeHost = puzzle.querySelector(".route-nodes") as HTMLElement;
  const status = puzzle.querySelector("#route-status") as HTMLElement;
  const feedback = puzzle.querySelector(".puzzle-feedback") as HTMLElement;
  const reset = puzzle.querySelector(".puzzle-reset") as HTMLButtonElement;
  let route: string[] = []; let finished = false;
  const render = () => {
    nodeHost.replaceChildren();
    for (const node of nodes) {
      const b = document.createElement("button"); b.type = "button";
      b.className = `route-node${route.includes(node.id) ? " selected" : ""}${!node.good ? " unsafe" : ""}`;
      b.innerHTML = `<span class="node-symbol">${node.symbol}</span><strong>${node.label}</strong><small>${route.includes(node.id) ? `STEP ${route.indexOf(node.id)+1}` : node.good ? "TRUSTED" : "UNTRUSTED"}</small>`;
      b.disabled = finished;
      b.addEventListener("click", () => {
        if (finished) return;
        const expected = correct[route.length];
        if (node.id !== expected) {
          gameState.integrity = Math.max(0, gameState.integrity - (node.good ? 5 : 12)); updateHUD();
          feedback.textContent = node.good ? "Not the next hop. Follow Operator → Gateway → Firewall → Learning Server." : "Blocked! That node is untrusted. Avoid it and rebuild the secure route.";
          feedback.classList.add("error"); return;
        }
        route.push(node.id); feedback.classList.remove("error"); status.textContent = `${route.length} / 4 NODES`;
        if (route.length === correct.length) {
          finished = true; gameState.xp += 150; gameState.flags.add("network-route-solved"); saveGame(); updateHUD();
          feedback.textContent = "SECURE ROUTE RESTORED. All trusted hops selected. +150 XP"; feedback.classList.add("success");
          nodeHost.querySelectorAll("button").forEach(btn => (btn as HTMLButtonElement).disabled = true); reset.disabled = true;
          const complete = document.createElement("button"); complete.className = "primary-btn"; complete.innerHTML = `COMPLETE MISSION <span>→</span>`;
          complete.addEventListener("click", () => { setModal(computerModal, false); completeMission("network", 0, "Secure route restored."); }); puzzle.appendChild(complete);
        } else { feedback.textContent = `Trusted hop accepted: ${node.label}. Choose the next node.`; }
        render();
      });
      nodeHost.appendChild(b);
    }
  };
  reset.addEventListener("click", () => { route = []; feedback.classList.remove("error", "success"); feedback.textContent = "Route reset. Start again with Operator."; status.textContent = "0 / 4 NODES"; render(); });
  render(); setModal(computerModal, true);
}

function openPhishing() {
  if (gameState.completed.has("phishing")) {
    showDialogue("Maya","Thanks again. The college IT team confirmed that the message was fraudulent. Remember: urgency is a common pressure tactic.",[{label:"Good to know. I'll stay alert.",action:closeDialogue}],"MISSION COMPLETE"); return;
  }
  computerShell("One message needs your attention","URGENT: Verify your student account","Campus Account Team <support@campus-verify.example>",
    `Hello student,<br><br>Your campus mailbox will be disabled in <b>10 minutes</b>. Confirm your password immediately to keep access.<br><br><span class="fake-link">https://campus-verify.example/session-check</span><br><br>Failure to act will result in account suspension.<br><br>— Campus Account Team`,
    "Unexpected urgency, an unverified sender, and a request for a password are warning signs. The .example domain is reserved for documentation and is not a real login service.",
    [
      {label:"Open the link and enter my password",correct:false,integrity:-25,xp:10,feedback:"The simulation flags the account as potentially compromised. Never enter credentials through an unexpected email link. Navigate to a known official site or verify with IT independently."},
      {label:"Reply and ask the sender if it is real",correct:false,integrity:-8,xp:20,feedback:"Replying confirms your address is active and does not verify the sender. Use a separate, trusted contact channel instead."},
      {label:"Report it and verify through the official college channel",correct:true,integrity:0,xp:100,feedback:"Correct. You avoided the link, recognized pressure tactics, and chose independent verification. Report suspicious messages through your institution's established process."}
    ],"phishing");
}
function openUSB() {
  if (gameState.completed.has("usb")) {
    showDialogue("Ravi","The unknown drive was handed to campus IT without being plugged in. The lab computers are safe.",[{label:"Return to the district.",action:closeDialogue}],"MISSION COMPLETE"); return;
  }
  computerShell("Removable media alert","UNKNOWN DEVICE FOUND","Lab assistant Ravi <ravi@campus.example>",
    `A USB drive labelled <b>EXAM_RESULTS_FINAL</b> was found outside the lab. Someone asks you to plug it in to identify the owner. The lab computer displays a simulated device alert: <b>Unrecognized removable media</b>.<br><br>No files have been opened and no device has been connected to a real computer.`,
    "Unknown removable media can contain malicious files or exploit vulnerabilities. This training scenario never accesses real devices.",
    [
      {label:"Plug it in and open the files",correct:false,integrity:-22,xp:10,feedback:"The simulation marks the workstation at risk. Do not connect unknown media to a personal or work device. Malware may run automatically or trick users into opening a file."},
      {label:"Use my personal laptop to check it",correct:false,integrity:-12,xp:20,feedback:"A personal device is not a safe testing environment. Avoid connecting the drive; report it to IT and let authorized staff follow their media-handling process."},
      {label:"Leave it disconnected and report it to IT",correct:true,integrity:0,xp:100,feedback:"Correct. You avoided unnecessary exposure and reported the device. Do not investigate unknown media on your own; follow your organization's security procedure."}
    ],"usb");
}
function openMFA() {
  if (gameState.completed.has("mfa")) {
    showDialogue("Nia","Your training account is protected. Never share a password or one-time code, even with someone claiming to be support.",[{label:"Finish chapter.",action:closeDialogue}],"MISSION COMPLETE"); return;
  }
  computerShell("Account security setup","Security alert: unusual sign-in attempt","Identity Service <security@accounts.example>",
    `A sign-in attempt was blocked. A person claiming to be support has messaged you: <b>“I can secure your account. Read me the six-digit verification code you just received.”</b><br><br>The training account currently has no multi-factor authentication enabled. You can review its fictional security settings below.`,
    "Never share a one-time code. Real support should not need you to disclose your password or authentication code.",
    [
      {label:"Share the verification code with support",correct:false,integrity:-25,xp:10,feedback:"A one-time code can allow an attacker to complete a sign-in. Never disclose it, even if the requester knows your name or claims to work for IT."},
      {label:"Ignore the alert and keep current settings",correct:false,integrity:-8,xp:25,feedback:"Ignoring suspicious sign-in activity leaves risk unresolved. Verify the alert through the official service, review active sessions, and strengthen account protection."},
      {label:"Refuse to share the code; enable MFA and review sessions",correct:true,integrity:0,xp:100,feedback:"Correct. You refused the social-engineering request, enabled an additional authentication factor, and reviewed sessions. Use a passkey or authenticator where available, and revoke sessions you do not recognize."}
    ],"mfa");
}
function handleInteract(it: Interactable) {
  if (it.prompt === "chapter-challenge") { startTimedChallenge(); return; }
  if (it.kind === "computer" && it.mission) { openComputer(it.mission); return; }
  if (it.kind === "npc") {
    if (it.id === "maya") {
      if (gameState.completed.has("phishing")) showDialogue("Maya","The suspicious email is reported. We should help the lab team check its devices next.",[{label:"I'll find Ravi.",action:closeDialogue}],"COLLEGE STUDENT");
      else showDialogue("Maya","Hey! I just got an alarming email saying our college accounts will be disabled in ten minutes. It asks me to sign in through a link. Can you help me figure out whether it is legitimate?",[
        {label:"Let's inspect the message carefully.",action:()=>{closeDialogue();showToast("Mission started: inspect the workstation beside Maya.");}},
        {label:"It's probably fine — click it quickly.",action:()=>{gameState.integrity=Math.max(0,gameState.integrity-8);updateHUD();closeDialogue();showToast("Rushing creates risk. Investigate the email workstation.");}}
      ],"CHAPTER 01 · FIRST CONTACT");
    } else if (it.id === "ravi") {
      if (!gameState.completed.has("phishing")) showDialogue("Ravi","Maya mentioned a suspicious email. Help her report it first, then come back — I have an unknown USB drive to deal with.",[{label:"I'll finish the email investigation first.",action:closeDialogue}],"LAB ASSISTANT");
      else if (gameState.completed.has("usb")) showDialogue("Ravi","Thanks for handling that drive safely. It has been handed to campus IT without being plugged in.",[{label:"Stay safe, Ravi.",action:closeDialogue}],"MISSION COMPLETE");
      else showDialogue("Ravi","I found a USB drive marked EXAM_RESULTS_FINAL. Someone suggested plugging it into the lab PC to identify its owner. That sounds risky. What should we do?",[
        {label:"Investigate the workstation's removable-media alert.",action:()=>{closeDialogue();showToast("Mission started: use the workstation beside Ravi.");}},
        {label:"Just plug it in — we need to know what's on it.",action:()=>{gameState.integrity=Math.max(0,gameState.integrity-8);updateHUD();closeDialogue();showToast("Unknown media is a risk. Check the workstation simulation.");}}
      ],"CHAPTER 01 · UNKNOWN DEVICE");
    } else if (it.id === "nia") {
      if (!gameState.completed.has("usb")) showDialogue("Nia","Before account security, help Ravi handle the unknown USB drive safely. Then we'll protect your training account.",[{label:"I'll help Ravi first.",action:closeDialogue}],"SECURITY MENTOR");
      else if (gameState.completed.has("mfa")) showDialogue("Nia","Strong work. You spotted the social-engineering attempt and secured the training account. Security is a habit, not a one-time task.",[{label:"Finish the chapter.",action:closeDialogue}],"MISSION COMPLETE");
      else showDialogue("Nia","We have a blocked sign-in attempt. Someone claiming to be support wants the six-digit verification code. We should secure the account instead of trusting the request. Ready?",[
        {label:"Open the account-security workstation.",action:()=>{closeDialogue();showToast("Mission started: use the workstation beside Nia.");}},
        {label:"Share the code so support can help.",action:()=>{gameState.integrity=Math.max(0,gameState.integrity-8);updateHUD();closeDialogue();showToast("Never share authentication codes. Review the workstation simulation.");}}
      ],"CHAPTER 01 · ACCOUNT DEFENSE");
    } else {
      if (!gameState.completed.has("mfa")) showDialogue("Officer Chen", "The network restoration console is ready, but first help Nia protect the training account. Then return for a route puzzle.", [{ label: "I'll secure the account first.", action: closeDialogue }], "CAMPUS SECURITY");
      else if (gameState.completed.has("network")) showDialogue("Officer Chen", "Excellent work. You restored the trusted route and avoided the untrusted node.", [{ label: "Glad to help.", action: closeDialogue }], "MISSION COMPLETE");
      else showDialogue("Officer Chen", "A route to the learning server has been isolated. Restore it by selecting trusted network hops in the correct order. Avoid the unknown node.", [{ label: "Open Network Ops.", action: () => { closeDialogue(); showToast("Use the Network Ops workstation beside Officer Chen."); } }], "CHAPTER 01 · NETWORK RESTORE");
    }
  }
}
function showEnding() {
  $("ending-xp").textContent = String(gameState.xp);
  $("ending-integrity").textContent = `${gameState.integrity}%`;
  $("ending-copy").textContent = gameState.integrity >= 80
    ? "You investigated the suspicious signal, handled unknown media safely, protected the training account, and restored a trusted network route. Your decisions helped keep the college district secure."
    : "You completed all three missions. A few risky choices reduced your digital integrity, but recognizing mistakes and following recovery steps is part of security practice.";
  const lessons = [
    "Verify unexpected requests using an independent, trusted channel.",
    "Never plug unknown removable media into your devices.",
    "Never share passwords or one-time codes; use MFA and review sessions.",
    "Use trusted network paths and isolate unknown nodes during incident response."
  ];
  const host = $("ending-lessons"); host.replaceChildren();
  lessons.forEach((lesson,i)=>{const row=document.createElement("div");row.className="lesson-item";row.innerHTML=`<b>0${i+1}</b><span>${escapeHtml(lesson)}</span>`;host.appendChild(row);});
  setModal(endingModal,true);
}
function restartChapter() {
  try { localStorage.removeItem("cyber-quest-save"); } catch {}
  location.reload();
}
function pauseGame() {
  if (!started || gameEnded || !pauseModal.classList.contains("hidden")) return;
  setModal(pauseModal,true);
}
function nearestInteractable() {
  let best: Interactable | null = null, bestDistance = 3.2;
  for (const it of interactables) {
    const d = Math.hypot(player.position.x - it.position.x, player.position.z - it.position.z);
    if (d < bestDistance) { best = it; bestDistance = d; }
  }
  return best;
}
function tryMove(dx: number, dz: number) {
  const radius = .42;
  const nextX = player.position.x + dx, nextZ = player.position.z + dz;
  tempBox.min.set(nextX-radius, .05, player.position.z-radius); tempBox.max.set(nextX+radius, 2.05, player.position.z+radius);
  const hitX = colliders.some(c => c.intersectsBox(tempBox));
  tempBox.min.set(player.position.x-radius, .05, nextZ-radius); tempBox.max.set(player.position.x+radius, 2.05, nextZ+radius);
  const hitZ = colliders.some(c => c.intersectsBox(tempBox));
  if (!hitX && Math.abs(nextX)<56) player.position.x=nextX;
  if (!hitZ && Math.abs(nextZ)<56) player.position.z=nextZ;
}
function updatePlayer(dt: number) {
  // Only gameplay dialogs should block movement. The title screen is handled
  // by `started`; excluding it here avoids a stale title-modal class freezing
  // movement after the player has entered the world.
  const blockingModalVisible = [dialogueModal, computerModal, pauseModal, endingModal]
    .some(modal => !modal.classList.contains("hidden"));
  modalOpen = blockingModalVisible || !started;
  if (!started || paused || blockingModalVisible || gameEnded) return;

  let forward = 0, side = 0;
  // Support both KeyboardEvent.code and normalized key aliases. The aliases make
  // movement resilient to keyboard layouts and browsers that report key values differently.
  if (keys.has("KeyW") || keys.has("ArrowUp") || keys.has("w")) forward += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown") || keys.has("s")) forward -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight") || keys.has("d")) side += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft") || keys.has("a")) side -= 1;
  moveDirection.set(0,0,0);
  cameraForward.set(-Math.sin(cameraYaw),0,-Math.cos(cameraYaw)).normalize();
  cameraRight.set(Math.cos(cameraYaw),0,-Math.sin(cameraYaw)).normalize();
  moveDirection.addScaledVector(cameraForward,forward).addScaledVector(cameraRight,side);
  if (moveDirection.lengthSq()>0) {
    moveDirection.normalize();
    const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("Shift") ? 8.5 : 5.2;
    tryMove(moveDirection.x*speed*dt,moveDirection.z*speed*dt);
    playerFacing = Math.atan2(moveDirection.x,moveDirection.z);
    player.rotation.y = THREE.MathUtils.damp(player.rotation.y,playerFacing,12,dt);
    player.position.y = Math.abs(Math.sin(performance.now()*.012))*0.045;
    playerBody.scale.y = 1 + Math.sin(performance.now()*.02)*.025;
  } else {
    player.position.y = 0;
    playerBody.scale.y = 1;
  }
}
function updateCamera(dt: number) {
  const target = player.position.clone().add(new THREE.Vector3(0,1.25,0));
  cameraTarget.lerp(target,1-Math.exp(-dt*7));
  const distance = 7.4;
  cameraDesired.set(
    player.position.x + Math.sin(cameraYaw)*distance,
    player.position.y + 3.1 + cameraPitch*3,
    player.position.z + Math.cos(cameraYaw)*distance
  );
  camera.position.lerp(cameraDesired,1-Math.exp(-dt*5));
  camera.lookAt(cameraTarget);
}
function updateInteractUI() {
  if (!started || modalOpen || gameEnded) { interactionHint.classList.remove("visible"); currentInteractable=null; return; }
  currentInteractable=nearestInteractable();
  if (currentInteractable) {
    interactionHint.classList.add("visible");
    interactionHint.innerHTML = `<kbd>E</kbd><span>${escapeHtml(currentInteractable.label.toUpperCase())}</span>`;
  } else interactionHint.classList.remove("visible");
}
function renderMinimap() {
  const ctx = minimapCtx;
  if (!ctx || !player) return;
  const w = minimapCanvas.width, h = minimapCanvas.height;
  const cx = w / 2, cy = h / 2, radius = 101;
  // Fixed, north-up map: the world stays still and John's marker moves with him.
  // This makes the player position visibly track across the map instead of being
  // pinned to the centre while the world rotates underneath it.
  const mapScale = 1.55;
  const worldToMap = (x: number, z: number) => ({
    x: cx + x * mapScale,
    y: cy + z * mapScale
  });
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "rgba(5, 15, 25, 0.94)"; ctx.fillRect(0, 0, w, h);

  // Street grid in fixed world coordinates.
  ctx.strokeStyle = "rgba(109, 153, 178, .23)"; ctx.lineWidth = 1;
  for (let grid = -60; grid <= 60; grid += 10) {
    const gx = cx + grid * mapScale;
    const gy = cy + grid * mapScale;
    ctx.beginPath(); ctx.moveTo(gx, cy - radius); ctx.lineTo(gx, cy + radius); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - radius, gy); ctx.lineTo(cx + radius, gy); ctx.stroke();
  }

  // Main streets/pathways are drawn from world coordinates, not player-relative coordinates.
  ctx.strokeStyle = currentChapter === 1 ? "rgba(198, 215, 220, .62)" : "rgba(101, 231, 255, .46)";
  ctx.lineWidth = currentChapter === 1 ? 12 : 9; ctx.lineCap = "square";
  let a = worldToMap(0, -50), b = worldToMap(0, 50);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  if (currentChapter === 1) {
    for (const z of [-20, 20]) {
      a = worldToMap(-42, z); b = worldToMap(42, z);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  } else {
    a = worldToMap(-36, -26); b = worldToMap(36, -26);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Objectives remain fixed to their actual world positions.
  for (const it of interactables) {
    const pt = worldToMap(it.position.x, it.position.z);
    if (Math.hypot(pt.x - cx, pt.y - cy) > radius - 8) continue;
    const isMission = Boolean(it.mission || it.prompt === "chapter-challenge");
    ctx.beginPath(); ctx.arc(pt.x, pt.y, isMission ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isMission ? "#ffd166" : "#65e7ff"; ctx.fill();
    ctx.strokeStyle = "rgba(3, 12, 20, .9)"; ctx.lineWidth = 2; ctx.stroke();
  }

  // John marker follows his actual X/Z position and rotates to his facing direction.
  const john = worldToMap(player.position.x, player.position.z);
  ctx.restore();
  ctx.save();
  ctx.translate(john.x, john.y);
  ctx.rotate(Math.PI - player.rotation.y);
  ctx.fillStyle = "rgba(101, 231, 255, .16)";
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(-12, -27); ctx.lineTo(12, -27); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-7, 7); ctx.lineTo(0, 4); ctx.lineTo(7, 7); ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#65e7ff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();

  // Keep the radar frame crisp above the clipped map contents.
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(101, 231, 255, .55)"; ctx.lineWidth = 2; ctx.stroke();
}

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.04);
  if (toastTimer>0) { toastTimer-=dt; if(toastTimer<=0)toast.classList.remove("visible"); }
  updatePlayer(dt);
  updateCamera(dt);
  updateInteractUI();
  renderMinimap();
  // Floating objective markers pulse to make NPCs easy to find.
  scene.traverse(obj=>{if(obj instanceof THREE.Group && obj.children.some(c=>c instanceof THREE.Mesh && c.geometry instanceof THREE.TorusGeometry)) obj.rotation.y=Math.sin(performance.now()*.0015)*.18;});
  renderer.render(scene,camera);
}
function onResize() {
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
}
function toggleSound() {
  soundOn=!soundOn;
  $("sound-btn").textContent=soundOn?"♫":"♪";
  if(soundOn) {
    try {
      audioCtx ||= new AudioContext();
      const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
      osc.type="sine";osc.frequency.value=110;gain.gain.value=.012;osc.connect(gain);gain.connect(audioCtx.destination);osc.start();
      window.setTimeout(()=>{try{osc.stop();}catch{}},180);
      showToast("Ambient audio test enabled. No external audio is loaded.");
    } catch { showToast("Audio is unavailable in this browser."); }
  } else showToast("Ambient audio muted.");
}
window.addEventListener("resize",onResize);
function onGameKeyDown(e: KeyboardEvent) {
  const code = e.code;
  const key = e.key.toLowerCase();
  const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

  // Prevent page scrolling while using the game controls.
  if (movementKeys.includes(code) && started && !modalOpen) e.preventDefault();

  if (code === "Escape") {
    if (!dialogueModal.classList.contains("hidden")) setModal(dialogueModal, false);
    else if (!computerModal.classList.contains("hidden")) { if(timerInterval){window.clearInterval(timerInterval);timerInterval=0;$("challenge-timer").classList.add("hidden");} setModal(computerModal, false); }
    else if (!startModal.classList.contains("hidden")) return;
    else if (!pauseModal.classList.contains("hidden")) setModal(pauseModal, false);
    else pauseGame();
    keys.clear();
    return;
  }

  if ((code === "KeyE" || key === "e") && started && !modalOpen && currentInteractable) {
    handleInteract(currentInteractable);
    return;
  }

  // Keep both code and key values so WASD works across keyboard layouts.
  keys.add(code);
  keys.add(key);
  if (started && !gameEnded && !paused && !modalOpen && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) {
    console.debug("Cyber Quest movement key:", code);
  }
}
function onGameKeyUp(e: KeyboardEvent) {
  keys.delete(e.code);
  keys.delete(e.key.toLowerCase());
}
// Capture at document level so the controls still work when a UI element had focus.
window.addEventListener("keydown", onGameKeyDown, true);
window.addEventListener("keyup", onGameKeyUp, true);
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => { if (document.hidden) keys.clear(); });
canvas.addEventListener("click",()=>{if(started&&!modalOpen&&!gameEnded)canvas.requestPointerLock?.();});
document.addEventListener("mousemove",(e)=>{
  if(document.pointerLockElement===canvas) {cameraYaw-=e.movementX*.0025;cameraPitch=THREE.MathUtils.clamp(cameraPitch-e.movementY*.0018,-.05,.8);}
  else if(dragging) {cameraYaw-=(e.clientX-lastMouseX)*.006;cameraPitch=THREE.MathUtils.clamp(cameraPitch-(e.clientY-lastMouseY)*.004,-.05,.8);lastMouseX=e.clientX;lastMouseY=e.clientY;}
});
canvas.addEventListener("mousedown",e=>{if(e.button===0&&document.pointerLockElement!==canvas){dragging=true;lastMouseX=e.clientX;lastMouseY=e.clientY;}});
window.addEventListener("mouseup",()=>dragging=false);
document.addEventListener("pointerlockchange",()=>{if(document.pointerLockElement!==canvas)keys.clear();});
document.querySelectorAll<HTMLElement>("[data-close]").forEach(btn=>btn.addEventListener("click",()=>{if(btn.dataset.close==="computer-modal"&&timerInterval){window.clearInterval(timerInterval);timerInterval=0;$("challenge-timer").classList.add("hidden");}setModal($(btn.dataset.close!),false);}));
function enterGame(mode: "new" | "load") {
  if (mode === "new") {
    chapterDone.clear();
    gameState.xp = 0;
    gameState.integrity = 100;
    gameState.completed.clear();
    gameState.flags.clear();
    gameState.currentMission = "phishing";
    buildChapterMap(1);
    saveGame();
  } else {
    const chapter = Number.isInteger(saved?.currentChapter) && saved.currentChapter >= 1 && saved.currentChapter <= 5
      ? (saved.currentChapter as ChapterId) : 1;
    buildChapterMap(chapter);
  }
  started = true;
  paused = false;
  setModal(startModal, false);
  ui.classList.add("ready");
  loading.style.opacity = "0";
  window.setTimeout(() => loading.remove(), 600);
  keys.clear();
  canvas.focus({ preventScroll: true });
  updateHUD();
  if (mode === "new") {
    showDialogue("JOHN — SYSTEM MESSAGE", "Alex has been pulled into CYBERGATE. Five digital worlds stand between you and your friend. Solve the challenges, collect access keys, and reach the Core before the Warden erases Alex’s identity.", [{ label: "I’m coming, Alex.", action: closeDialogue }], "INCOMING MESSAGE · 23:47");
    showToast("Chapter 1: find Maya near the college entrance.");
  } else {
    showToast(`SAVE LOADED · Chapter 0${currentChapter}. Your progress has been restored.`);
  }
}
$("start-btn").addEventListener("click", () => enterGame("new"));
$("load-btn").addEventListener("click", () => enterGame("load"));
const loadButton = $("load-btn") as HTMLButtonElement;
const saveStatus = $("save-status");
const hasSave = Boolean(saved && (Number(saved.xp) > 0 || (Array.isArray(saved.chapterDone) && saved.chapterDone.length) || (Array.isArray(saved.completed) && saved.completed.length) || (Number(saved.currentChapter) > 1)));
loadButton.disabled = !hasSave;
saveStatus.textContent = hasSave ? `Saved progress found · Chapter 0${saved.currentChapter || 1} · ${Number(saved.xp) || 0} XP` : "No saved progress found on this browser.";
$("pause-btn").addEventListener("click",pauseGame);
$("resume-btn").addEventListener("click",()=>setModal(pauseModal,false));
$("restart-btn").addEventListener("click",restartChapter);
$("ending-restart").addEventListener("click",restartChapter);
$("sound-btn").addEventListener("click",toggleSound);

const logoutBtn = document.createElement("button");
logoutBtn.textContent = "LOGOUT";
logoutBtn.type = "button";

logoutBtn.style.position = "fixed";
logoutBtn.style.top = "16px";
logoutBtn.style.right = "16px";
logoutBtn.style.zIndex = "9999";
logoutBtn.style.padding = "10px 18px";
logoutBtn.style.background = "#b42318";
logoutBtn.style.color = "#ffffff";
logoutBtn.style.border = "1px solid #ff7777";
logoutBtn.style.borderRadius = "8px";
logoutBtn.style.fontWeight = "bold";
logoutBtn.style.cursor = "pointer";

logoutBtn.addEventListener("click", async () => {
  const confirmLogout = window.confirm("Are you sure you want to log out?");
  if (!confirmLogout) return;

  logoutBtn.disabled = true;

  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    if (!response.ok) {
      throw new Error("Logout failed. Please try again.");
    }

    window.location.replace("/login.html");
  } catch (error) {
    alert(error instanceof Error ? error.message : "Could not log out.");
    logoutBtn.disabled = false;
  }
});

document.body.appendChild(logoutBtn);

// Navigation tabs switch between distinct story locations. Later chapters unlock as earlier ones are completed.
document.querySelectorAll<HTMLButtonElement>(".chapter-tab").forEach(btn=>btn.addEventListener("click",()=>{
  const target=Number(btn.dataset.chapter) as ChapterId;
  const unlocked=chapterDone.size ? Math.max(...chapterDone)+1 : 1;
  if(target>unlocked){showToast("This chapter is locked. Complete the previous chapter first.");return;}
  if(!started){showToast("Press ENTER THE DIGITAL CITY first.");return;}
  if(!dialogueModal.classList.contains("hidden")||!computerModal.classList.contains("hidden")||!pauseModal.classList.contains("hidden"))return;
  buildChapterMap(target);
}));


buildWorld();
buildPlayer();
if(Number.isInteger(saved?.currentChapter)&&saved.currentChapter>=1&&saved.currentChapter<=5&&(saved.currentChapter!==1||chapterDone.has(1))){buildChapterMap((chapterDone.has(1)&&saved.currentChapter===1?2:saved.currentChapter) as ChapterId);}
updateHUD();
// Restore completed state safely, but let the player start from the title screen.
cameraYaw=0;
animate();
window.setTimeout(()=>{loading.style.opacity="0";window.setTimeout(()=>loading.remove(),600);},850);

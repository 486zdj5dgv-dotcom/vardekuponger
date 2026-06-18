import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// 1) Byt ut detta mot din egen Firebase config från Project settings > Your apps > Web app.
const firebaseConfig = {
  apiKey: "AIzaSyBYXFLhizk0PprBLJrDugIbPl8rvZxw6NA",
  authDomain: "vardekuponger.firebaseapp.com",
  projectId: "vardekuponger",
  storageBucket: "vardekuponger.firebasestorage.app",
  messagingSenderId: "893309862780",
  appId: "1:893309862780:web:6493356498fc7994fbdaf9",
  measurementId: "G-GV5N53GFSD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
let currentUser = null;
let currentProfile = null;
let couponTypes = [];

const panels = ["checkPanel", "createCouponPanel", "typesPanel", "usersPanel", "historyPanel"];
const roleNames = { admin: "Admin", chef: "Chef", personal: "Personal" };

function defaultExpiryDate(){
  const d = new Date(); d.setFullYear(d.getFullYear()+1);
  return d.toISOString().slice(0,10);
}
function makeCode(typeName){
  const prefix = typeName.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, "").slice(0,5) || "KUP";
  return `${prefix}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
}
function showPanel(id){
  panels.forEach(p => $(p).classList.toggle("hidden", p !== id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.panel === id));
}
function canCreateCoupons(){ return ["admin", "chef"].includes(currentProfile?.role); }
function isAdmin(){ return currentProfile?.role === "admin"; }

async function ensureProfile(user){
  const userRef = doc(db, "users", user.email.toLowerCase());
  const snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  const pendingRef = doc(db, "pendingUsers", user.email.toLowerCase());
  const pending = await getDoc(pendingRef);
  if (pending.exists()) {
    const data = pending.data();
    const profile = { email: user.email.toLowerCase(), role: data.role, active: true, createdAt: serverTimestamp() };
    await setDoc(userRef, profile);
    return profile;
  }
  return { email: user.email.toLowerCase(), role: "none", active: false };
}

async function loadTypes(){
  const snap = await getDocs(query(collection(db,"couponTypes"), orderBy("name")));
  couponTypes = snap.docs.map(d => ({id:d.id, ...d.data()}));
  if (couponTypes.length === 0 && isAdmin()) {
    await addDoc(collection(db,"couponTypes"), { name:"Valfri meny", active:true, createdAt:serverTimestamp() });
    await addDoc(collection(db,"couponTypes"), { name:"Cheeseburgare", active:true, createdAt:serverTimestamp() });
    return loadTypes();
  }
  $("couponTypeSelect").innerHTML = couponTypes.filter(t=>t.active !== false).map(t => `<option value="${t.id}">${t.name}</option>`).join("");
  $("typesList").innerHTML = couponTypes.map(t => `<div class="item"><div><strong>${t.name}</strong><br><small>${t.active===false?"Inaktiv":"Aktiv"}</small></div>${isAdmin()?`<button class="danger" data-delete-type="${t.id}">Ta bort</button>`:""}</div>`).join("");
}

async function loadUsers(){
  if(!isAdmin()) return;

  const users = await getDocs(collection(db,"users"));
  const rows = [];

  users.forEach(d => rows.push({
    email: d.data().email || d.id,
    uid: d.id,
    ...d.data(),
    pending: false
  }));

  $("usersList").innerHTML = rows.map(u => `
    <div class="item">
      <div>
        <strong>${u.email || "Saknar e-post"}</strong><br>
        <small>${roleNames[u.role] || u.role}</small>
      </div>
    </div>
  `).join("");
}

async function loadCoupons(){
  const snap = await getDocs(query(collection(db,"coupons"), orderBy("createdAt", "desc"), limit(30)));
  $("couponsList").innerHTML = snap.docs.map(d => {
    const c = d.data();
    return `<div class="item"><div><strong>${c.code}</strong><br><small>${c.typeName} • ${c.redeemed?"Använd":"Ej använd"} • Giltig till ${c.expiresAt}</small></div></div>`;
  }).join("");
}

function renderTabs(){
  const tabs = [{id:"checkPanel",label:"Checka"}];
  if(canCreateCoupons()) tabs.push({id:"createCouponPanel",label:"Skapa kupong"},{id:"historyPanel",label:"Kuponger"});
  if(isAdmin()) tabs.push({id:"typesPanel",label:"Kupongtyper"},{id:"usersPanel",label:"Användare"});
  $("tabs").innerHTML = tabs.map(t => `<button class="tab" data-panel="${t.id}">${t.label}</button>`).join("");
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => showPanel(t.dataset.panel));
  showPanel("checkPanel");
}

async function refresh(){
  $("roleBadge").textContent = roleNames[currentProfile.role] || "Ej aktiverad";
  $("setupPanel").classList.toggle("hidden", currentProfile.role !== "none");
  renderTabs();
  await loadTypes();
  await loadUsers();
  await loadCoupons();
}

$("loginBtn").onclick = async () => {
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch(e){ $("loginMessage").textContent = e.message; }
};
$("registerBtn").onclick = async () => {
  try { await createUserWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch(e){ $("loginMessage").textContent = e.message; }
};
$("logoutBtn").onclick = () => signOut(auth);

$("makeAdminBtn").onclick = async () => {
  await setDoc(doc(db,"users",currentUser.email.toLowerCase()), { email: currentUser.email.toLowerCase(), role:"admin", active:true, createdAt:serverTimestamp() });
  currentProfile = await ensureProfile(currentUser);
  await refresh();
};

$("saveUserRoleBtn").onclick = async () => {
  const email = $("userEmail").value.trim().toLowerCase();
  const role = $("userRole").value;
  if(!email) return;
  await setDoc(doc(db,"pendingUsers",email), { role, active:true, updatedAt:serverTimestamp(), updatedBy:currentUser.email });
  $("userEmail").value = "";
  await loadUsers();
};

$("addTypeBtn").onclick = async () => {
  const name = $("newTypeName").value.trim();
  if(!name) return;
  await addDoc(collection(db,"couponTypes"), { name, active:true, createdAt:serverTimestamp(), createdBy:currentUser.email });
  $("newTypeName").value = "";
  await loadTypes();
};
$("typesList").onclick = async (e) => {
  const id = e.target.dataset.deleteType;
  if(id && confirm("Ta bort kupongtypen?")) { await deleteDoc(doc(db,"couponTypes",id)); await loadTypes(); }
};

$("createCouponBtn").onclick = async () => {
  const typeId = $("couponTypeSelect").value;
  const type = couponTypes.find(t => t.id === typeId);
  if(!type) return;
  const code = makeCode(type.name);
  const expiresAt = $("expiresAt").value || defaultExpiryDate();
  await setDoc(doc(db,"coupons",code), { code, typeId, typeName:type.name, expiresAt, redeemed:false, createdAt:serverTimestamp(), createdBy:currentUser.email });
  $("newCouponBox").classList.remove("hidden");
  $("newCouponBox").textContent = code;
  await loadCoupons();
};

$("checkBtn").onclick = async () => {
  const code = $("checkCode").value.trim().toUpperCase();
  const box = $("couponResult");
  box.className = "result";
  box.classList.remove("hidden");
  if(!code){ box.classList.add("bad"); box.textContent = "Skriv en kod först."; return; }
  const ref = doc(db,"coupons",code);
  const snap = await getDoc(ref);
  if(!snap.exists()){ box.classList.add("bad"); box.innerHTML = "❌ Kupongen finns inte."; return; }
  const c = snap.data();
  const today = new Date().toISOString().slice(0,10);
  if(c.redeemed){ box.classList.add("bad"); box.innerHTML = `❌ Redan använd<br><small>Använd av ${c.redeemedBy || "okänd"}</small>`; return; }
  if(c.expiresAt < today){ box.classList.add("bad"); box.innerHTML = `❌ Utgången ${c.expiresAt}`; return; }
  box.classList.add("ok");
  box.innerHTML = `✅ Giltig kupong: <strong>${c.typeName}</strong><br><button id="redeemNow">Lös in kupong</button>`;
  $("redeemNow").onclick = async () => {
    await updateDoc(ref, { redeemed:true, redeemedAt:serverTimestamp(), redeemedBy:currentUser.email });
    box.innerHTML = `✅ Kupongen är nu inlöst: <strong>${c.typeName}</strong>`;
    await loadCoupons();
  };
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  $("loginView").classList.toggle("hidden", !!user);
  $("mainView").classList.toggle("hidden", !user);
  if(user){
    currentProfile = await ensureProfile(user);
    $("expiresAt").value = defaultExpiryDate();
    await refresh();
  }
});

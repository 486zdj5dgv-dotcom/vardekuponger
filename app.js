import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
let allCoupons = [];
let qrScanner = null;

const panels = [
  "dashboardPanel",
  "checkPanel",
  "createCouponPanel",
  "typesPanel",
  "usersPanel",
  "historyPanel",
  "logsPanel"
];

const roleNames = {
  admin: "Admin",
  chef: "Chef",
  personal: "Personal"
};

function safeEl(id) {
  return document.getElementById(id);
}

function defaultExpiryDate(){
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0,10);
}

function todayString(){
  return new Date().toISOString().slice(0,10);
}

function makeCode(typeName){
  const prefix = typeName.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, "").slice(0,5) || "KUP";
  return `${prefix}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
}

function canCreateCoupons(){
  return ["admin", "chef"].includes(currentProfile?.role);
}

function isAdmin(){
  return currentProfile?.role === "admin";
}

function canViewLogs(){
  return ["admin", "chef"].includes(currentProfile?.role);
}

function showPanel(id){
  panels.forEach(p => {
    const el = safeEl(p);
    if(el) el.classList.toggle("hidden", p !== id);
  });

  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.panel === id);
  });
}

async function writeLog(action, details = {}){
  try {
    if(!currentUser) return;

    await addDoc(collection(db, "logs"), {
      action,
      details,
      user: currentUser.email || "okänd",
      createdAt: serverTimestamp()
    });
  } catch(e) {
    console.warn("Kunde inte skriva logg:", e);
  }
}

async function ensureProfile(user){
  const email = user.email.toLowerCase();
  const userRef = doc(db, "users", email);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const profile = snap.data();

    if (profile.active === false) {
      await signOut(auth);
      alert("Detta konto är inaktiverat. Kontakta administratör.");
      return {
        email,
        role: "none",
        active: false
      };
    }

    return profile;
  }

  const pendingRef = doc(db, "pendingUsers", email);
  const pending = await getDoc(pendingRef);

  if (pending.exists()) {
    const data = pending.data();

    const profile = {
      email,
      name: data.name || email,
      role: data.role,
      active: true,
      createdAt: serverTimestamp()
    };

    await setDoc(userRef, profile);
    await deleteDoc(pendingRef);

    return profile;
  }

  return {
    email,
    name: email,
    role: "none",
    active: false
  };
}

async function loadTypes(){
  const snap = await getDocs(query(collection(db,"couponTypes"), orderBy("name")));
  couponTypes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (couponTypes.length === 0 && isAdmin()) {
    await addDoc(collection(db,"couponTypes"), {
      name: "Valfri meny",
      active: true,
      createdAt: serverTimestamp()
    });

    await addDoc(collection(db,"couponTypes"), {
      name: "Cheeseburgare",
      active: true,
      createdAt: serverTimestamp()
    });

    return loadTypes();
  }

  if(safeEl("couponTypeSelect")){
    $("couponTypeSelect").innerHTML = couponTypes
      .filter(t => t.active !== false)
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join("");
  }

  if(safeEl("typesList")){
    $("typesList").innerHTML = couponTypes.map(t => `
      <div class="item">
        <div>
          <strong>${t.name}</strong><br>
          <small>${t.active === false ? "Inaktiv" : "Aktiv"}</small>
        </div>

        ${isAdmin() ? `
          <button class="danger" data-delete-type="${t.id}">
            Ta bort
          </button>
        ` : ""}
      </div>
    `).join("");
  }
}

async function loadUsers(){
  if(!isAdmin() || !safeEl("usersList")) return;

  const usersSnap = await getDocs(collection(db,"users"));
  const pendingSnap = await getDocs(collection(db,"pendingUsers"));

  const activeUsers = [];
  const inactiveUsers = [];
  const pendingUsers = [];

  usersSnap.forEach(d => {
    const data = d.data();

    const u = {
      email: data.email || d.id,
      name: data.name || "",
      role: data.role,
      active: data.active !== false,
      pending: false
    };

    if (u.active) activeUsers.push(u);
    else inactiveUsers.push(u);
  });

  pendingSnap.forEach(d => {
    const data = d.data();

    pendingUsers.push({
      email: d.id,
      name: data.name || "",
      role: data.role,
      active: false,
      pending: true
    });
  });

  function renderUser(u){
    return `
      <div class="item">
        <div>
          <strong>${u.name || u.email}</strong><br>
          <small>
            ${u.email}<br>
            ${roleNames[u.role] || u.role}
            ${u.pending ? " • väntar på registrering" : u.active ? " • aktiv" : " • inaktiv"}
          </small>
        </div>

        <div class="actions">
          ${u.pending ? `
            <button class="danger deletePendingBtn" data-email="${u.email}">
              Ta bort
            </button>
          ` : `
            <select class="roleSelect" data-email="${u.email}">
              <option value="personal" ${u.role === "personal" ? "selected" : ""}>Personal</option>
              <option value="chef" ${u.role === "chef" ? "selected" : ""}>Chef</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            </select>

            <button class="${u.active ? "danger" : "secondary"} toggleUserBtn"
                    data-email="${u.email}"
                    data-active="${u.active}">
              ${u.active ? "Inaktivera" : "Aktivera"}
            </button>
          `}
        </div>
      </div>
    `;
  }

  $("usersList").innerHTML = `
    <h3>Aktiva användare</h3>
    ${activeUsers.length ? activeUsers.map(renderUser).join("") : "<p>Inga aktiva användare.</p>"}

    <h3>Väntar på registrering</h3>
    ${pendingUsers.length ? pendingUsers.map(renderUser).join("") : "<p>Inga väntande användare.</p>"}

    <h3>Inaktiva användare</h3>
    ${inactiveUsers.length ? inactiveUsers.map(renderUser).join("") : "<p>Inga inaktiva användare.</p>"}
  `;
}

async function loadCoupons(){
  if(!safeEl("couponsList") && !safeEl("statsGrid")) return;

  const snap = await getDocs(query(collection(db,"coupons"), orderBy("createdAt", "desc"), limit(200)));

  allCoupons = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  renderCoupons();
  renderDashboard();
}

function renderCoupons(){
  if(!safeEl("couponsList")) return;

  const search = (safeEl("couponSearch")?.value || "").trim().toUpperCase();

  const filtered = allCoupons.filter(c =>
    !search ||
    (c.code || "").toUpperCase().includes(search) ||
    (c.typeName || "").toUpperCase().includes(search)
  );

  $("couponsList").innerHTML = filtered.map(c => `
    <div class="item">
      <div>
        <strong>${c.code}</strong><br>
        <small>
          ${c.typeName}<br>
          ${c.redeemed ? "Använd" : "Ej använd"} • Giltig till ${c.expiresAt}<br>
          Skapad av: ${c.createdBy || "okänd"}<br>
          ${c.redeemed ? `Inlöst av: ${c.redeemedBy || "okänd"}` : ""}
        </small>
      </div>
    </div>
  `).join("");
}

function renderDashboard(){
  if(!safeEl("statsGrid")) return;

  const today = todayString();

  const active = allCoupons.filter(c => !c.redeemed && c.expiresAt >= today).length;
  const redeemed = allCoupons.filter(c => c.redeemed).length;
  const expired = allCoupons.filter(c => !c.redeemed && c.expiresAt < today).length;
  const total = allCoupons.length;

  $("statsGrid").innerHTML = `
    <div class="stat-card">
      <strong>${active}</strong>
      <span>Aktiva kuponger</span>
    </div>
    <div class="stat-card">
      <strong>${redeemed}</strong>
      <span>Inlösta kuponger</span>
    </div>
    <div class="stat-card">
      <strong>${expired}</strong>
      <span>Utgångna kuponger</span>
    </div>
    <div class="stat-card">
      <strong>${total}</strong>
      <span>Totalt skapade</span>
    </div>
  `;
}

async function loadLogs(){
  if(!canViewLogs() || !safeEl("logsList")) return;

  try {
    const snap = await getDocs(query(collection(db,"logs"), orderBy("createdAt", "desc"), limit(50)));

    $("logsList").innerHTML = snap.docs.map(d => {
      const l = d.data();

      return `
        <div class="item">
          <div>
            <strong>${l.action}</strong><br>
            <small>
              ${l.user || "okänd"}<br>
              ${JSON.stringify(l.details || {})}
            </small>
          </div>
        </div>
      `;
    }).join("");
  } catch(e) {
    $("logsList").innerHTML = `<p>Kunde inte läsa loggen: ${e.message}</p>`;
  }
}

function renderTabs(){
  const tabs = [
    { id:"checkPanel", label:"Checka" }
  ];

  if(safeEl("dashboardPanel")) {
    tabs.unshift({ id:"dashboardPanel", label:"Dashboard" });
  }

  if(canCreateCoupons()) {
    tabs.push(
      { id:"createCouponPanel", label:"Skapa kupong" },
      { id:"historyPanel", label:"Kuponger" }
    );

    if(safeEl("logsPanel")) {
      tabs.push({ id:"logsPanel", label:"Logg" });
    }
  }

  if(isAdmin()) {
    tabs.push(
      { id:"typesPanel", label:"Kupongtyper" },
      { id:"usersPanel", label:"Användare" }
    );
  }

  $("tabs").innerHTML = tabs
    .map(t => `<button class="tab" data-panel="${t.id}">${t.label}</button>`)
    .join("");

  document.querySelectorAll(".tab").forEach(t => {
    t.onclick = () => showPanel(t.dataset.panel);
  });

  showPanel("checkPanel");
}

async function refresh(){
  $("roleBadge").textContent = roleNames[currentProfile.role] || "Ej aktiverad";
  $("setupPanel").classList.toggle("hidden", currentProfile.role !== "none");

  renderTabs();

  await loadTypes();
  await loadUsers();
  await loadCoupons();
  await loadLogs();
}

$("loginBtn").onclick = async () => {
  try {
    $("loginMessage").textContent = "";
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch(e) {
    $("loginMessage").textContent = e.message;
  }
};

$("registerBtn").onclick = async () => {
  try {
    $("loginMessage").textContent = "";

    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;

    if(!email || !password) {
      $("loginMessage").textContent = "Skriv e-post och lösenord. Lösenordet måste vara minst 6 tecken.";
      return;
    }

    const pending = await getDoc(doc(db, "pendingUsers", email));

    if(!pending.exists()) {
      $("loginMessage").textContent = "Din e-post är inte tillagd av admin ännu.";
      return;
    }

    await createUserWithEmailAndPassword(auth, email, password);
  } catch(e) {
    $("loginMessage").textContent = e.message;
  }
};

if(safeEl("resetPasswordBtn")){
  $("resetPasswordBtn").onclick = async () => {
    const email = $("email").value.trim();

    if(!email) {
      $("loginMessage").textContent = "Skriv in din e-post först.";
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      $("loginMessage").textContent = "Återställningsmail skickat.";
    } catch(e) {
      $("loginMessage").textContent = e.message;
    }
  };
}

$("logoutBtn").onclick = () => signOut(auth);

$("makeAdminBtn").onclick = async () => {
  const email = currentUser.email.toLowerCase();

  await setDoc(doc(db,"users",email), {
    email,
    name: currentUser.email,
    role: "admin",
    active: true,
    createdAt: serverTimestamp()
  });

  currentProfile = await ensureProfile(currentUser);

  await writeLog("Gjorde sig själv till admin", { email });
  await refresh();
};

$("saveUserRoleBtn").onclick = async () => {
  const email = $("userEmail").value.trim().toLowerCase();
  const role = $("userRole").value;
  const name = safeEl("userName") ? $("userName").value.trim() : "";

  if(!email) return;

  await setDoc(doc(db,"pendingUsers",email), {
    email,
    name,
    role,
    active: false,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });

  if(safeEl("userEmail")) $("userEmail").value = "";
  if(safeEl("userName")) $("userName").value = "";

  await writeLog("Lade till väntande användare", { email, role });
  await loadUsers();
  await loadLogs();
};

document.addEventListener("click", async (e) => {
  if(e.target.classList.contains("toggleUserBtn")) {
    const email = e.target.dataset.email;
    const isActive = e.target.dataset.active === "true";

    if(!confirm(`${isActive ? "Inaktivera" : "Aktivera"} ${email}?`)) return;

    await updateDoc(doc(db, "users", email), {
      active: !isActive
    });

    await writeLog(isActive ? "Inaktiverade användare" : "Aktiverade användare", { email });
    await loadUsers();
    await loadLogs();
  }

  if(e.target.classList.contains("deletePendingBtn")) {
    const email = e.target.dataset.email;

    if(!confirm(`Ta bort väntande användare ${email}?`)) return;

    await deleteDoc(doc(db, "pendingUsers", email));

    await writeLog("Tog bort väntande användare", { email });
    await loadUsers();
    await loadLogs();
  }
});

document.addEventListener("change", async (e) => {
  if(!e.target.classList.contains("roleSelect")) return;

  const email = e.target.dataset.email;
  const role = e.target.value;

  await updateDoc(doc(db, "users", email), {
    role
  });

  await writeLog("Ändrade roll", { email, role });
  await loadUsers();
  await loadLogs();
});

$("addTypeBtn").onclick = async () => {
  const name = $("newTypeName").value.trim();

  if(!name) return;

  await addDoc(collection(db,"couponTypes"), {
    name,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });

  $("newTypeName").value = "";

  await writeLog("Skapade kupongtyp", { name });
  await loadTypes();
  await loadLogs();
};

$("typesList").onclick = async (e) => {
  const id = e.target.dataset.deleteType;

  if(id && confirm("Ta bort kupongtypen?")) {
    await deleteDoc(doc(db,"couponTypes",id));

    await writeLog("Tog bort kupongtyp", { id });
    await loadTypes();
    await loadLogs();
  }
};

$("createCouponBtn").onclick = async () => {
  const typeId = $("couponTypeSelect").value;
  const type = couponTypes.find(t => t.id === typeId);

  if(!type) return;

  const code = makeCode(type.name);
  const expiresAt = $("expiresAt").value || defaultExpiryDate();

  await setDoc(doc(db,"coupons",code), {
    code,
    typeId,
    typeName: type.name,
    expiresAt,
    redeemed: false,
    createdAt: serverTimestamp(),
    createdBy: currentUser.email
  });

  const couponLink =
    window.location.origin +
    window.location.pathname +
    "?code=" +
    encodeURIComponent(code);

  const qrUrl =
    "https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=" +
    encodeURIComponent(couponLink);

  $("newCouponBox").classList.remove("hidden");
  $("newCouponBox").innerHTML = `
    <div style="text-align:center">
      <img src="${qrUrl}" alt="QR-kod" style="width:260px;max-width:100%;border-radius:16px;background:white;padding:12px;">
      <h3>Kupongkod</h3>
      <div style="font-size:28px;font-weight:bold;letter-spacing:1px;">${code}</div>
      <p>Gästen kan visa QR-koden eller uppge koden manuellt.</p>
    </div>
  `;

  await writeLog("Skapade kupong", { code, typeName: type.name });
  await loadCoupons();
  await loadLogs();
};

$("scanQrBtn").onclick = async () => {
  const reader = $("qrReader");

  reader.classList.remove("hidden");
  reader.innerHTML = "";

  if (qrScanner) {
    await qrScanner.stop().catch(() => {});
  }

  qrScanner = new Html5Qrcode("qrReader");

  try {
    await qrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      async (decodedText) => {
        let code = decodedText;

        try {
          const url = new URL(decodedText);
          code = url.searchParams.get("code") || decodedText;
        } catch {}

        $("checkCode").value = code.trim().toUpperCase();

        await qrScanner.stop();
        reader.classList.add("hidden");

        $("checkBtn").click();
      }
    );
  } catch (err) {
    console.error(err);
    alert("Kunde inte starta kameran. Kontrollera att kameraåtkomst är tillåten.");
  }
};

$("checkBtn").onclick = async () => {
  const code = $("checkCode").value.trim().toUpperCase();
  const box = $("couponResult");

  box.className = "result";
  box.classList.remove("hidden");

  if(!code) {
    box.classList.add("bad");
    box.textContent = "Skriv en kod först.";
    return;
  }

  const ref = doc(db,"coupons",code);
  const snap = await getDoc(ref);

  if(!snap.exists()) {
    box.classList.add("bad");
    box.innerHTML = "❌ Kupongen finns inte.";
    return;
  }

  const c = snap.data();
  const today = todayString();

  if(c.redeemed) {
    box.classList.add("bad");
    box.innerHTML = `❌ Redan använd<br><small>Använd av ${c.redeemedBy || "okänd"}</small>`;
    return;
  }

  if(c.expiresAt < today) {
    box.classList.add("bad");
    box.innerHTML = `❌ Utgången ${c.expiresAt}`;
    return;
  }

  box.classList.add("ok");
  box.innerHTML = `
    ✅ Giltig kupong: <strong>${c.typeName}</strong><br>
    <button id="redeemNow">Lös in kupong</button>
  `;

  $("redeemNow").onclick = async () => {
    await updateDoc(ref, {
      redeemed: true,
      redeemedAt: serverTimestamp(),
      redeemedBy: currentUser.email
    });

    await writeLog("Löste in kupong", { code, typeName: c.typeName });

    box.innerHTML = `✅ Kupongen är nu inlöst: <strong>${c.typeName}</strong>`;

    await loadCoupons();
    await loadLogs();
  };
};

if(safeEl("couponSearch")){
  $("couponSearch").oninput = renderCoupons;
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  $("loginView").classList.toggle("hidden", !!user);
  $("mainView").classList.toggle("hidden", !user);

  if(user) {
    currentProfile = await ensureProfile(user);

    if(currentProfile.active === false) return;

    $("expiresAt").value = defaultExpiryDate();

    await refresh();

    const params = new URLSearchParams(window.location.search);
    const qrCode = params.get("code");

    if(qrCode) {
      $("checkCode").value = qrCode.trim().toUpperCase();
      showPanel("checkPanel");
    }
  }
});

const $ = id => document.getElementById(id);
const views = ["welcomeView","setupView","credentialsView","recoverView","chatView"];
let token = null, session = null, selectedGender = "girl", pendingCredentials = null, selectedMode = "AUTO";
let toastTimer;

function showView(id) {
  views.forEach(v => $(v).classList.toggle("hidden", v !== id));
  $("historyBtn").classList.toggle("hidden", id !== "chatView");
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(path, options = {}) {
  const headers = { "Content-Type":"application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function setSession(data, accessToken) {
  session = data; token = accessToken;
  localStorage.setItem("klinsmd_token", token);
  $("chatPersonName").textContent = session.display_name;
  $("personAvatar").textContent = session.display_name.slice(0,1).toUpperCase();
  selectedMode = session.preferences?.mode || "AUTO";
  updateModeUI(); renderHistory(session.history || []);
  showView("chatView");
}
function updateModeUI() {
  $("modeStatus").textContent = `MODE · ${selectedMode}`;
  document.querySelectorAll(".mode-option").forEach(b => b.classList.toggle("active", b.dataset.mode === selectedMode));
  const lang = session?.preferences?.language || "AUTO";
  $("languageStatus").textContent = `LANGUAGE · ${lang.toUpperCase()}`;
}
function renderHistory(history) {
  const list = $("messageList"); list.innerHTML = "";
  if (!history.length) {
    list.innerHTML = '<div class="welcome-message"><div class="mini-logo">K</div><h3>You\'re in control.</h3><p>Paste their latest message. I\'ll read the vibe and give you one reply worth sending.</p></div>';
    return;
  }
  history.forEach((item, index) => {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${item.role === "assistant" ? "reply" : "theirs"}`;
    const meta = document.createElement("div"); meta.className = "bubble-meta";
    meta.textContent = item.role === "assistant" ? "KLINSMD · SUGGESTED REPLY" : session.display_name.toUpperCase();
    const content = document.createElement("div"); content.textContent = item.content;
    bubble.append(meta, content);
    if (item.role === "assistant") {
      const tools = document.createElement("div"); tools.className = "reply-tools";
      const copy = document.createElement("button"); copy.className = "copy-reply"; copy.textContent = "▣ COPY REPLY";
      copy.addEventListener("click", () => copyText(item.content));
      tools.append(copy); bubble.append(tools);
    }
    list.append(bubble);
  });
  list.scrollTop = list.scrollHeight;
}
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); toast("Copied. Go make your move."); }
  catch { toast("Copy unavailable on this browser."); }
}
function modal(title, message, confirmLabel, action) {
  $("modalTitle").textContent = title; $("modalText").textContent = message;
  $("modalConfirm").textContent = confirmLabel;
  $("confirmModal").classList.remove("hidden");
  $("modalConfirm").onclick = async () => {
    $("confirmModal").classList.add("hidden");
    await action();
  };
}
$("modalCancel").onclick = () => $("confirmModal").classList.add("hidden");
$("startBtn").onclick = () => { selectedGender = "girl"; document.querySelectorAll(".gender-card").forEach(b=>b.classList.toggle("selected",b.dataset.gender==="girl")); $("personName").value=""; showView("setupView"); };
$("continueBtn").onclick = () => showView("recoverView");
document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => showView(b.dataset.back));
document.querySelectorAll(".gender-card").forEach(b => b.onclick = () => {
  selectedGender = b.dataset.gender;
  document.querySelectorAll(".gender-card").forEach(x=>x.classList.toggle("selected",x===b));
});
$("createBtn").onclick = async () => {
  const personName = $("personName").value.trim();
  if (!personName) return toast("Enter their name first.");
  $("createBtn").disabled = true; $("createBtn").textContent = "CREATING YOUR CHAT…";
  try {
    const data = await api("/api/sessions", { method:"POST", body:JSON.stringify({personName,targetGender:selectedGender}) });
    pendingCredentials = data.credentials;
    session = data.session; token = data.token;
    $("sessionNameValue").textContent = data.credentials.sessionName;
    $("recoveryCodeValue").textContent = data.credentials.recoveryCode;
    $("recoveryKeyValue").textContent = data.credentials.recoveryKey;
    $("copyCredentials").onclick = () => copyText(
      `KLINSMD 4 PRO IV\nSession name: ${data.credentials.sessionName}\nRecovery code: ${data.credentials.recoveryCode}\nPrivate recovery key: ${data.credentials.recoveryKey}`
    );
    showView("credentialsView");
  } catch (e) { toast(e.message); }
  finally { $("createBtn").disabled=false; $("createBtn").innerHTML='CREATE MY CHAT <span>→</span>'; }
};
$("enterChatBtn").onclick = () => {
  if (!pendingCredentials || !token || !session) return toast("Create a new chat first.");
  setSession(session, token); pendingCredentials = null;
};
$("recoverBtn").onclick = async () => {
  const body = { sessionName:$("recoverName").value.trim(), recoveryCode:$("recoverCode").value.trim(), recoveryKey:$("recoverKey").value.trim() };
  $("recoverBtn").disabled=true; $("recoverBtn").textContent="RESTORING…";
  try {
    const data = await api("/api/sessions/recover",{method:"POST",body:JSON.stringify(body)});
    setSession(data.session,data.token); toast("Conversation restored.");
  } catch(e) { toast(e.message); }
  finally { $("recoverBtn").disabled=false; $("recoverBtn").innerHTML='RESTORE MY CONVERSATION <span>→</span>'; }
};
$("generateBtn").onclick = async () => {
  const message = $("messageInput").value.trim();
  if (!message) return toast("Paste their message first.");
  $("generateBtn").disabled=true; $("generateBtn").innerHTML="✦ READING THE VIBE…";
  const oldHistory = [...(session.history || [])];
  renderHistory([...oldHistory,{role:"them",content:message}]);
  try {
    const data = await api("/api/chat",{method:"POST",body:JSON.stringify({message,mode:selectedMode})});
    session.history = data.history; session.preferences = {...session.preferences,language:data.meta.language,mode:selectedMode,lastMeta:data.meta};
    renderHistory(session.history); $("messageInput").value=""; $("charCount").textContent="0 / 1200";
    $("languageStatus").textContent=`LANGUAGE · ${(data.meta.language||"AUTO").toUpperCase()}`;
    $("egoIndicator").classList.toggle("hidden",!data.meta.ego);
    $("analysisBar").classList.remove("hidden");
    $("analysisBar").textContent=`${data.meta.tone || "Tone unclear"} · ${data.meta.interest || "Interest unclear"} · ${data.meta.conversation || "Flowing"}`;
  } catch(e) { renderHistory(oldHistory); toast(e.message); }
  finally { $("generateBtn").disabled=false; $("generateBtn").innerHTML="<span>✦</span> GENERATE REPLY"; }
};
$("messageInput").addEventListener("input",()=> $("charCount").textContent=`${$("messageInput").value.length} / 1200`);
$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("generateBtn").click();}});
$("settingsBtn").onclick = () => $("settingsPanel").classList.toggle("hidden");
$("closeSettings").onclick = () => $("settingsPanel").classList.add("hidden");
document.querySelectorAll(".mode-option").forEach(b=>b.onclick=async()=>{
  const next=b.dataset.mode;
  try { await api("/api/sessions/preferences",{method:"PATCH",body:JSON.stringify({mode:next})}); selectedMode=next; session.preferences={...session.preferences,mode:next}; updateModeUI(); $("settingsPanel").classList.add("hidden"); toast(`${next} mode selected.`); }
  catch(e){toast(e.message);}
});
function newChat() {
  modal("Start a new conversation?","Your current conversation remains saved. A completely separate chat will be created.","NEW CHAT",()=>{
    token=null;session=null;pendingCredentials=null;localStorage.removeItem("klinsmd_token");showView("welcomeView");
  });
}
$("newChatBtn").onclick=newChat; $("mobileNewBtn").onclick=newChat;
$("deleteChatBtn").onclick=()=>modal("Delete this conversation?","This permanently deletes this chat and its saved message history. You cannot undo this action.","DELETE",async()=>{
  try { await api("/api/sessions/current",{method:"DELETE"}); token=null;session=null;localStorage.removeItem("klinsmd_token");showView("welcomeView");toast("Conversation deleted."); }
  catch(e){toast(e.message);}
});
$("historyBtn").onclick=()=>{ if(session) {renderHistory(session.history||[]); toast("Showing saved conversation history.");} };
(async function boot(){
  const saved=localStorage.getItem("klinsmd_token");
  if(!saved){showView("welcomeView");return;}
  token=saved;
  try { const data=await api("/api/sessions/current");setSession(data.session,saved); }
  catch { token=null;localStorage.removeItem("klinsmd_token");showView("welcomeView"); }
})();

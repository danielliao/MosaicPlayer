const status = document.querySelector("#status");
let code = "";
async function post(path, body) {
  const response = await fetch(path, {method:"POST",headers:{"Content-Type":"application/json","X-Mosaic-Capabilities":"programs,audio,freeform"},body:JSON.stringify(body),redirect:"error"});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "请求失败");
  return data;
}
document.querySelector("#resolve").onsubmit = async event => {
  event.preventDefault();
  document.querySelector("#join").hidden = true;
  try {
    code = document.querySelector("#code").value.trim();
    const data = await post("/api/pairing/resolve", {code});
    const select = document.querySelector("#screen"); select.replaceChildren();
    for (const group of data.groups) for (const screen of group.layout.screens) {
      const option = new Option(`${group.name} · 第 ${screen.row * group.layout.cols + screen.col + 1} 块屏${screen.online || screen.reserved ? "（已占用）" : ""}`, screen.id);
      option.disabled = Boolean(screen.online || screen.reserved); select.append(option);
    }
    const available = [...select.options].find(o => !o.disabled);
    if (!available) throw Error("没有可选的屏幕位置");
    select.value = available.value;
    document.querySelector("#join").hidden = false; status.textContent = "请选择本机对应的屏幕。";
  } catch (e) { status.textContent = e.message; }
};
document.querySelector("#join").onsubmit = async event => {
  event.preventDefault(); document.querySelector("#join-button").disabled = true;
  try {
    const result = await post("/api/pair", {code,screenId:document.querySelector("#screen").value,client:"browser",name:"浏览器播放端"});
    location.replace(`/play?screen=${encodeURIComponent(result.screenId)}&key=${encodeURIComponent(result.key)}`);
  } catch (e) { status.textContent = e.message; document.querySelector("#join-button").disabled = false; }
};

"use strict";
// Presentation choices only. No bridge, credentials, business data or storage.
const themes = new Map([["a", "A · Enterprise Minimal"], ["b", "B · Commercial Precision"], ["c", "C · Modern Professional POS"]]);
const screens = new Set(Array.from(document.querySelector("#screen").options, option => option.value));
const params = new URLSearchParams(location.search);
const theme = document.querySelector("#theme");
const screen = document.querySelector("#screen");
const density = document.querySelector("#density");
theme.value = themes.has(params.get("theme")) ? params.get("theme") : "b";
screen.value = screens.has(params.get("screen")) ? params.get("screen") : "inventario";
density.value = params.get("density") === "touch" ? "touch" : "desktop";
function render() {
  document.documentElement.dataset.theme = theme.value;
  document.documentElement.dataset.density = density.value;
  const source = document.getElementById("view-" + screen.value);
  document.getElementById("content").replaceChildren(source.content.cloneNode(true));
  document.getElementById("direction").textContent = themes.get(theme.value);
  for (const button of document.querySelectorAll("[data-screen]")) {
    if (button.dataset.screen === screen.value) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
for (const control of [theme, screen, density]) control.addEventListener("change", render);
for (const button of document.querySelectorAll("[data-screen]")) button.addEventListener("click", () => {
  screen.value = button.dataset.screen; render(); document.getElementById("content").focus();
});
render();

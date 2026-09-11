/*
 * 取景器接线：行为契约照 ~/.pi/agent/skills/prototype/PICKER.md。
 * 切换变体 = 重新挂载（入场动效重跑）；R 键重放，不换变体。
 */
(function () {
  const variants = window.RHG_VARIANTS;
  const stage = document.getElementById("stage");
  const picker = document.querySelector(".proto-picker");
  const highlight = picker.querySelector(".proto-picker-highlight");
  const items = Array.from(picker.querySelectorAll(".proto-picker-item:not(.proto-picker-replay)"));
  const replay = picker.querySelector(".proto-picker-replay");
  let current = 0;

  function moveHighlight() {
    const el = items[current];
    highlight.style.width = el.offsetWidth + "px";
    highlight.style.transform = "translateX(" + el.offsetLeft + "px)";
  }

  function mount(i) {
    stage.innerHTML = "";
    // 先清空，下一帧再渲染，让入场动效重跑。
    requestAnimationFrame(function () { variants[i].render(); });
  }

  function setActive(i) {
    if (i < 0 || i >= variants.length) return;
    current = i;
    items.forEach(function (el, j) {
      el.toggleAttribute("data-active", j === i);
      if (j === i) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    });
    moveHighlight();
    const url = new URL(location);
    url.searchParams.set("v", i + 1);
    history.replaceState(null, "", url);
    mount(i);
  }

  items.forEach(function (el, i) { el.addEventListener("click", function () { setActive(i); }); });
  if (replay) replay.addEventListener("click", function () { mount(current); });
  window.addEventListener("resize", moveHighlight);

  document.addEventListener("keydown", function (event) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= variants.length) setActive(num - 1);
    else if (event.key === "ArrowRight") setActive((current + 1) % variants.length);
    else if (event.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length);
    else if (event.key === "r" || event.key === "R") mount(current);
  });

  setActive((parseInt(new URLSearchParams(location.search).get("v"), 10) || 1) - 1);
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { picker.setAttribute("data-ready", ""); });
  });
})();

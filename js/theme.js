// Runs before first paint (classic script in <head>) so there's no flash of the wrong theme.
// Dark is the default; "light" is the only other choice, saved on this device.
(function () {
  try {
    if (localStorage.getItem("snooker.theme") === "light") {
      document.documentElement.dataset.theme = "light";
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute("content", "#f6f5f1");
    }
  } catch (e) {}
})();

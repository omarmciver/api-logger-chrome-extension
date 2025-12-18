console.log("DevTools script starting...");

chrome.devtools.panels.create(
  "API Logger",
  "",  // Empty icon path (icons are optional)
  "devtools/panel.html",
  (panel) => {
    if (chrome.runtime.lastError) {
      console.error("Panel creation failed:", chrome.runtime.lastError.message);
      return;
    }
    console.log("API Logger panel created successfully");
    panel.onShown.addListener(() => console.log("API Logger panel shown"));
    panel.onHidden.addListener(() => console.log("API Logger panel hidden"));
  }
);

console.log("DevTools panel.create() called");

document.querySelectorAll("[data-copy-citation]").forEach((button, index) => {
  const status = document.createElement("p");
  status.className = "citation-copy-status";
  status.id = `citation-copy-status-${index}`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  button.parentElement.append(status);
  let fallback, field, resetTimer, copying = false;

  function manualCopy() {
    if (!fallback) {
      fallback = document.createElement("div");
      fallback.className = "citation-copy-fallback";
      const label = document.createElement("label");
      label.textContent = "Citation to copy";
      field = document.createElement("textarea");
      field.className = "citation-copy-text";
      field.id = `citation-copy-text-${index}`;
      field.readOnly = true;
      field.rows = 4;
      field.value = button.dataset.copyCitation;
      field.setAttribute("aria-describedby", status.id);
      label.htmlFor = field.id;
      fallback.append(label, field);
      status.after(fallback);
    }
    fallback.hidden = false;
    field.focus();
    field.select();
  }

  button.addEventListener("click", async () => {
    if (copying) return;
    copying = true;
    clearTimeout(resetTimer);
    button.textContent = "Copy citation";
    button.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.textContent = "Copying citation…";
    try {
      await navigator.clipboard.writeText(button.dataset.copyCitation);
      if (fallback) {
        if (fallback.contains(document.activeElement)) button.focus({ preventScroll: true });
        fallback.hidden = true;
      }
      button.textContent = "Copied";
      status.textContent = "Citation copied.";
      resetTimer = setTimeout(() => { button.textContent = "Copy citation"; }, 1600);
    } catch (error) {
      status.textContent = "Automatic copying is unavailable. Copy the selected citation below.";
      manualCopy();
    } finally {
      copying = false;
      button.removeAttribute("aria-busy");
    }
  });
});

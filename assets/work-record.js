document.querySelectorAll("[data-copy-citation]").forEach(button => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyCitation);
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy citation"; }, 1600);
    } catch (error) {
      button.textContent = "Copy failed";
    }
  });
});

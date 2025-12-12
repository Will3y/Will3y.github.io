const nav = document.querySelector("#nav");
const navToggle = document.querySelector("#navToggle");

if (nav && navToggle) {
  navToggle.addEventListener("click", () => {
    nav.classList.toggle("open");
    navToggle.setAttribute(
      "aria-expanded",
      nav.classList.contains("open") ? "true" : "false"
    );
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("open"));
  });
}

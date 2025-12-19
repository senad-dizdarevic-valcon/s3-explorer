(function () {
  setTimeout(function () {
    var banners = document.querySelectorAll(".banner");
    if (!banners || banners.length === 0) return;
    banners.forEach(function (bannerEl) {
      bannerEl.classList.add("banner--fade-out");
      setTimeout(function () {
        bannerEl.style.display = "none";
      }, 2000);
    });
  }, 10000);
})();

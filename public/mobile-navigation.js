(function () {
  const menu = document.querySelector('.mobile-menu');
  if (!menu) return;
  menu.addEventListener('click', function (event) {
    if (event.target.closest('a')) menu.open = false;
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', function (event) {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
})();

function renderSidebar(activePage) {
  const user = getUser();
  const rol = user ? user.rol : '';

  const links = [
    { href: '/index.html', icon: 'bi-speedometer2', text: 'Dashboard', roles: ['admin','cajero','bodeguero','supervisor','gerente'] },
    { href: '/categorias.html', icon: 'bi-tags', text: 'Categorias', roles: ['admin','bodeguero','supervisor'] },
    { href: '/productos.html', icon: 'bi-box-seam', text: 'Productos', roles: ['admin','bodeguero','supervisor','cajero'] },
    { href: '/proveedores.html', icon: 'bi-truck', text: 'Proveedores', roles: ['admin','bodeguero','supervisor'] },
    { href: '/compras.html', icon: 'bi-cart-plus', text: 'Compras', roles: ['admin','bodeguero','supervisor'] },
    { href: '/inventario.html', icon: 'bi-clipboard-data', text: 'Inventario', roles: ['admin','bodeguero','supervisor'] },
    { href: '/pos.html', icon: 'bi-cash-stack', text: 'POS / Ventas', roles: ['admin','cajero','supervisor'] },
    { href: '/caja.html', icon: 'bi-safe', text: 'Caja', roles: ['admin','cajero','supervisor'] },
    { href: '/mermas.html', icon: 'bi-exclamation-triangle', text: 'Mermas', roles: ['admin','bodeguero','supervisor'] },
    { href: '/reportes.html', icon: 'bi-graph-up', text: 'Reportes', roles: ['admin','gerente','supervisor'] },
    { href: '/clientes.html', icon: 'bi-people', text: 'Clientes', roles: ['admin','cajero','supervisor'] },
    { href: '/auditoria.html', icon: 'bi-shield-check', text: 'Auditoria', roles: ['admin','gerente'] },
  ];

  const nav = links
    .filter(l => l.roles.includes(rol))
    .map(l => `<a href="${l.href}" class="nav-link ${activePage === l.href ? 'active' : ''}"><i class="bi ${l.icon}"></i> ${l.text}</a>`)
    .join('');

  document.getElementById('sidebar').innerHTML = `
    <div class="brand">Supermercado Avicola</div>
    <nav class="nav flex-column mt-2">${nav}</nav>
    <div class="position-absolute bottom-0 w-100 p-3 border-top border-light border-opacity-25">
      <small class="d-block text-light text-opacity-75">${user ? user.nombre_completo : ''}</small>
      <small class="d-block text-light text-opacity-50 text-capitalize">${rol}</small>
      <a href="#" onclick="logout()" class="btn btn-outline-light btn-sm mt-2 w-100">Cerrar sesion</a>
    </div>
  `;
}

function renderTopBar(title) {
  document.getElementById('topbar').innerHTML = `
    <div>
      <button class="btn btn-sm btn-outline-secondary d-md-none me-2" onclick="document.getElementById('sidebar').classList.toggle('show')">
        <i class="bi bi-list"></i>
      </button>
      <strong>${title}</strong>
    </div>
    <div class="text-muted small">${formatDateTime(new Date().toISOString())}</div>
  `;
}

function initPage(title, activePage) {
  requireAuth();
  renderSidebar(activePage);
  renderTopBar(title);
}

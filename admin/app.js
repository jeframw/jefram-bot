const API = '';
let token = localStorage.getItem('admin_token');
let user = JSON.parse(localStorage.getItem('admin_user'));

async function api(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + url, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

if (token && user) {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    renderUser();
    showSection('dashboard');
}

function renderUser() {
    document.getElementById('userArea').innerHTML = `<span>${user.phone}</span> <button class="logout-btn" onclick="logout()">Logout</button>`;
}

function login() {
    const phone = document.getElementById('phoneInput').value.trim();
    if (!phone) return;
    fetch('/api/admin/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ phone }) })
        .then(r => r.json()).then(d => {
            token = d.token; user = d.user;
            localStorage.setItem('admin_token', token);
            localStorage.setItem('admin_user', JSON.stringify(user));
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
            renderUser();
            showSection('dashboard');
        }).catch(e => { document.getElementById('loginError').textContent = e.message; });
}

function logout() {
    token = null; user = null;
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    location.reload();
}

function showSection(name) {
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(name);
    if (el) el.style.display = 'block';
    event.target.classList.add('active');
    if (name === 'dashboard') loadDashboard();
    if (name === 'products') loadProducts();
    if (name === 'orders') loadOrders();
}

async function loadDashboard() {
    try {
        const stats = await api('/api/dashboard');
        document.getElementById('stats').innerHTML = `
            <div class="stat-card"><div class="value">${stats.totalProducts || 0}</div><div class="label">Products</div></div>
            <div class="stat-card"><div class="value">${stats.totalOrders || 0}</div><div class="label">Orders</div></div>
            <div class="stat-card"><div class="value">${stats.pendingOrders || 0}</div><div class="label">Pending</div></div>
            <div class="stat-card"><div class="value">${stats.totalRevenue || 0}</div><div class="label">Revenue (UGX)</div></div>
        `;
    } catch(e) {}
}

async function loadProducts() {
    try {
        const products = await api('/api/products');
        document.getElementById('productList').innerHTML = `
            <table><thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
            <tbody>${products.map(p => `<tr><td>${p.name}</td><td>${formatPrice(p.price)}</td><td>${p.stock}</td><td><button class="btn-sm" onclick="editProduct('${p.id}')">Edit</button><button class="btn-sm btn-danger" onclick="deleteProduct('${p.id}')">Delete</button></td></tr>`).join('')}</tbody></table>
        `;
    } catch(e) {}
}

function showProductForm(product) {
    document.getElementById('editProductId').value = product ? product.id : '';
    document.getElementById('productName').value = product ? product.name : '';
    document.getElementById('productDesc').value = product ? product.description : '';
    document.getElementById('productPrice').value = product ? product.price : '';
    document.getElementById('productStock').value = product ? product.stock : '';
    document.getElementById('productImage').value = product ? product.image_urls : '';
    document.getElementById('productModalTitle').textContent = product ? 'Edit Product' : 'Add Product';
    document.getElementById('productModal').style.display = 'flex';
}
function hideProductForm() { document.getElementById('productModal').style.display = 'none'; }

async function saveProduct() {
    const id = document.getElementById('editProductId').value;
    const data = {
        name: document.getElementById('productName').value,
        description: document.getElementById('productDesc').value,
        price: Number(document.getElementById('productPrice').value),
        stock: Number(document.getElementById('productStock').value),
    };
    const image = document.getElementById('productImage').value;
    if (image) data.image_urls = image;
    try {
        if (id) await api(`/api/products/${id}`, { method:'PUT', body:JSON.stringify(data) });
        else await api('/api/products', { method:'POST', body:JSON.stringify(data) });
        hideProductForm(); loadProducts();
    } catch(e) { alert(e.message); }
}

async function editProduct(id) {
    try {
        const products = await api('/api/products');
        const product = products.find(p => p.id === id);
        if (product) showProductForm(product);
    } catch(e) {}
}

async function deleteProduct(id) {
    if (!confirm('Delete this product?')) return;
    try { await api(`/api/products/${id}`, { method:'DELETE' }); loadProducts(); } catch(e) { alert(e.message); }
}

async function loadOrders() {
    try {
        const orders = await api('/api/orders');
        const container = document.getElementById('orderList');
        if (!orders.length) { container.innerHTML = '<p>No orders</p>'; return; }
        container.innerHTML = orders.map(o => `
            <div class="order-card">
                <div><span class="order-id">${o.order_number}</span> — ${formatPrice(o.total)}</div>
                <div>Status: <span class="status-badge status-${o.status}">${o.status}</span></div>
                <div>Payment: ${o.payment_method === 'online' ? 'Online' : o.payment_method === 'half_half' ? '50/50' : 'Delivery'} | Status: ${o.status}</div>
                <div>Client: ${o.customer_phone || 'Unknown'}</div>
                <div style="margin-top:6px;">
                    <button class="btn-sm btn-success" onclick="updateStatus('${o.id}','confirmed')" ${o.status === 'confirmed' ? 'disabled' : ''}>Confirm Order</button>
                    <button class="btn-sm btn-secondary" onclick="updateStatus('${o.id}','on_way')" ${o.status !== 'confirmed' ? 'disabled' : ''}>Mark On Way</button>
                    <button class="btn-sm btn-success" onclick="updateStatus('${o.id}','delivered')" ${o.status !== 'on_way' ? 'disabled' : ''}>Delivered</button>
                </div>
            </div>
        `).join('');
    } catch(e) {}
}

async function updateStatus(orderId, status) {
    try { await api(`/api/orders/${orderId}/status`, { method:'PATCH', body:JSON.stringify({ status }) }); loadOrders(); } catch(e) { alert(e.message); }
}

function formatPrice(p) { return (p || 0).toLocaleString('en-US', { style:'currency', currency:'UGX', minimumFractionDigits:0 }); }
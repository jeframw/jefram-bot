const API = '';
let token = localStorage.getItem('admin_token');
let user = JSON.parse(localStorage.getItem('admin_user'));
let selectedImages = [];
const MAX_IMAGES = 3;

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
    document.getElementById('productModalTitle').textContent = product ? 'Edit Product' : 'Add Product';
    
    // Reset image handling
    selectedImages = [];
    updateImagePreview();
    document.getElementById('productImages').value = '';
    
    // If editing and product has existing images, show them
    if (product && product.image_urls && Array.isArray(product.image_urls)) {
        const previewContainer = document.getElementById('imagePreview');
        const countElement = document.getElementById('imageCount');
        
        product.image_urls.forEach((url, index) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'image-preview-item';
            previewItem.innerHTML = `
                <img src="${url}" alt="Existing image">
                <button class="remove-btn" onclick="removeExistingImage('${url}')">×</button>
            `;
            previewContainer.appendChild(previewItem);
        });
        
        countElement.textContent = `${product.image_urls.length}/${MAX_IMAGES} existing images`;
    }
    
    document.getElementById('productModal').style.display = 'flex';
}

function hideProductForm() { 
    document.getElementById('productModal').style.display = 'none';
    selectedImages = [];
    updateImagePreview();
}

function handleImageUpload(event) {
    const files = Array.from(event.target.files);
    
    // Check if adding these files would exceed the limit
    if (selectedImages.length + files.length > MAX_IMAGES) {
        alert(`You can only upload a maximum of ${MAX_IMAGES} images. Currently selected: ${selectedImages.length}`);
        event.target.value = ''; // Reset input
        return;
    }
    
    // Add new files to selected images
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            selectedImages.push(file);
        }
    });
    
    updateImagePreview();
}

function updateImagePreview() {
    const previewContainer = document.getElementById('imagePreview');
    const countElement = document.getElementById('imageCount');
    
    previewContainer.innerHTML = '';
    countElement.textContent = `${selectedImages.length}/${MAX_IMAGES} images selected`;
    
    selectedImages.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewItem = document.createElement('div');
            previewItem.className = 'image-preview-item';
            previewItem.innerHTML = `
                <img src="${e.target.result}" alt="Preview">
                <button class="remove-btn" onclick="removeImage(${index})">×</button>
            `;
            previewContainer.appendChild(previewItem);
        };
        reader.readAsDataURL(file);
    });
}

function removeImage(index) {
    selectedImages.splice(index, 1);
    updateImagePreview();
    document.getElementById('productImages').value = '';
}

function removeExistingImage(url) {
    // For now, we'll just remove it from the preview
    // In a full implementation, you'd want to track this and remove it when saving
    const previewItems = document.querySelectorAll('.image-preview-item');
    previewItems.forEach(item => {
        if (item.querySelector('img').src === url) {
            item.remove();
        }
    });
    
    // Update count
    const countElement = document.getElementById('imageCount');
    const currentCount = parseInt(countElement.textContent.split('/')[0]);
    countElement.textContent = `${currentCount - 1}/${MAX_IMAGES} images`;
}

async function uploadImages() {
    if (selectedImages.length === 0) return [];
    
    const formData = new FormData();
    selectedImages.forEach((file, index) => {
        formData.append('images', file);
    });
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Failed to upload images');
        }
        
        const data = await response.json();
        return data.urls || [];
    } catch (error) {
        console.error('Image upload error:', error);
        throw error;
    }
}

async function saveProduct() {
    const id = document.getElementById('editProductId').value;
    const data = {
        name: document.getElementById('productName').value,
        description: document.getElementById('productDesc').value,
        price: Number(document.getElementById('productPrice').value),
        stock: Number(document.getElementById('productStock').value),
    };
    
    try {
        // Get existing images from preview
        const existingImages = [];
        document.querySelectorAll('.image-preview-item img').forEach(img => {
            existingImages.push(img.src);
        });
        
        // Upload new images if any are selected
        if (selectedImages.length > 0) {
            const newImageUrls = await uploadImages();
            data.image_urls = [...existingImages, ...newImageUrls];
        } else if (existingImages.length > 0) {
            data.image_urls = existingImages;
        }
        
        if (id) await api(`/api/products/${id}`, { method:'PUT', body:JSON.stringify(data) });
        else await api('/api/products', { method:'POST', body:JSON.stringify(data) });
        hideProductForm(); loadProducts();
    } catch(e) { 
        alert(e.message || 'Failed to save product. Please try again.'); 
    }
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
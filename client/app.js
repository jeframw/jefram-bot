const API = '';
let cart = [];
let products = [];
let token = localStorage.getItem('jefram_token');
let user = JSON.parse(localStorage.getItem('jefram_user'));

async function api(url, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + url, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

async function loadProducts() {
    try {
        products = await api('/api/products');
        renderProducts();
    } catch (e) {
        document.getElementById('products').innerHTML = '<p>Failed to load products.</p>';
    }
}

function renderProducts() {
    const grid = document.getElementById('products');
    grid.innerHTML = products.map(p => `
        <div class="product-card">
            ${p.image_urls ? `<img src="${p.image_urls[0]}" alt="${p.name}">` : '<div style="height:200px;background:#eee;display:flex;align-items:center;justify-content:center;color:#999;">No Image</div>'}
            <div class="info">
                <div class="name">${p.name}</div>
                <div class="desc">${(p.description || '').substring(0, 80)}</div>
                <div class="price">${formatPrice(p.price)}</div>
                <div class="stock">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</div>
                <button class="add-btn" onclick="addToCart('${p.id}',${p.stock > 0})" ${p.stock <= 0 ? 'disabled' : ''}>Add to Cart</button>
            </div>
        </div>
    `).join('');
}

function formatPrice(p) {
    return (p || 0).toLocaleString('en-US', { style:'currency', currency:'UGX', minimumFractionDigits:0 });
}

function addToCart(productId, canAdd) {
    if (!canAdd) return;
    if (!user && !token) {
        const phone = prompt('Enter your phone number:');
        if (!phone) return;
        fetch('/api/auth/register', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ phone }) })
            .then(r => r.json()).then(d => {
                token = d.token; user = d.user;
                localStorage.setItem('jefram_token', token);
                localStorage.setItem('jefram_user', JSON.stringify(user));
                doAddToCart(productId);
            }).catch(() => showToast('Registration failed'));
        return;
    }
    doAddToCart(productId);
}

function doAddToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const existing = cart.find(i => i.id === productId);
    if (existing) { existing.quantity++; }
    else { cart.push({ id:product.id, name:product.name, price:product.price, image_urls:product.image_urls, quantity:1 }); }
    updateCartUI();
    showToast('Added to cart');
}

function updateCartUI() {
    document.getElementById('cartCount').textContent = cart.reduce((s, i) => s + i.quantity, 0);
    if (cart.length) showCart();
}

function showCart() {
    const modal = document.getElementById('cartModal');
    modal.style.display = 'flex';
    const itemsDiv = document.getElementById('cartItems');
    if (!cart.length) { itemsDiv.innerHTML = '<p>Cart is empty</p>'; document.getElementById('cartTotal').textContent = ''; document.getElementById('paymentSection').style.display = 'none'; return; }
    itemsDiv.innerHTML = cart.map((i, idx) => `
        <div class="cart-item">
            <div class="details"><div>${i.name}</div><div class="price">${formatPrice(i.price * i.quantity)}</div></div>
            <div class="qty"><button onclick="cart[${idx}].quantity--;if(cart[${idx}].quantity<=0)cart.splice(${idx},1);updateCartUI();">-</button><span>${i.quantity}</span><button onclick="cart[${idx}].quantity++;updateCartUI();">+</button></div>
        </div>
    `).join('');
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    document.getElementById('cartTotal').textContent = 'Total: ' + formatPrice(total);
    document.getElementById('paymentSection').style.display = 'block';
    updatePaymentInfo(total);
}

function hideCart() { document.getElementById('cartModal').style.display = 'none'; }

function updatePaymentInfo(total) {
    const minOnline = 100000;
    const info = document.getElementById('paymentInfo');
    const onlineRadio = document.querySelector('input[name=payment][value=online]');
    const deliveryRadio = document.querySelector('input[name=payment][value=delivery]');
    if (total < minOnline) {
        onlineRadio.checked = true; deliveryRadio.disabled = true;
        info.className = 'payment-info';
        info.textContent = 'Total is below ' + formatPrice(minOnline) + ' — Full online payment required.';
    } else {
        onlineRadio.disabled = false; deliveryRadio.disabled = false;
        info.className = 'payment-info warn';
        info.innerHTML = 'Total is ' + formatPrice(total) + ' or more — Half online (50%), remaining 50% on delivery.';
    }
}

document.querySelectorAll('input[name=payment]').forEach(r => { r.addEventListener('change', function() { const total = cart.reduce((s,i)=>s+i.price*i.quantity,0); updatePaymentInfo(total); }); });

async function placeOrder() {
    try {
        const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const paymentMethod = document.querySelector('input[name=payment]:checked').value;
        const address = prompt('Delivery address:');
        if (!address) return;
        const order = await api('/api/orders', { method:'POST', body:JSON.stringify({ items:cart.map(i=>({id:i.id,name:i.name,price:i.price,quantity:i.quantity})), delivery_address:address, payment_method:paymentMethod }) });
        hideCart();
        document.getElementById('orderInfo').innerHTML = `<p class="order-success">Order Placed!</p><p>Order #: ${order.order_number}</p><p>Total: ${formatPrice(order.total)}</p><p>Payment: ${order.payment_method === 'online' ? 'Online' : order.payment_method === 'half_half' ? '50% Online, 50% Delivery' : 'On Delivery'}</p><p>Status: ${order.status}</p>`;
        document.getElementById('orderModal').style.display = 'flex';
        cart = []; updateCartUI();
    } catch (e) { showToast(e.message); }
}

function hideOrder() { document.getElementById('orderModal').style.display = 'none'; }
function showToast(msg) { const t = document.createElement('div'); t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#333;color:white;padding:12px 20px;border-radius:8px;z-index:9999;'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }

loadProducts();
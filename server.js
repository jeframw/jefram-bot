const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a secure value of at least 32 characters.');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'client')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const adminOnly = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

function generateOrderNumber() {
  return `JF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function calcTotal(items) {
  return items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
}

function determinePayment(total) {
  const minOnline = 100000;
  if (total < minOnline) {
    return { method: 'online', amountPaid: 0, amountDue: total, status: 'pending' };
  }
  return { method: 'half_half', amountPaid: 0, amountDue: total, status: 'pending' };
}

// ==================== AUTH ====================

app.post('/api/admin/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const { data, error } = await supabase.from('profiles').select('*').eq('phone', phone).single();
    if (error || !data) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (data.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const token = jwt.sign({ id: data.id, phone: data.phone, role: data.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: data.id, phone: data.phone, name: data.name, role: data.role } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone } = req.body;
    const { data, error } = await supabase.from('profiles').select('*').eq('phone', phone).single();
    if (error || !data) {
      return res.status(404).json({ error: 'User not found' });
    }
    const token = jwt.sign({ id: data.id, phone: data.phone, role: data.role || 'customer' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: data.id, phone: data.phone, name: data.name, role: data.role || 'customer' } });
  } catch (e) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const { data, error } = await supabase.from('profiles').upsert({ phone, name }, { onConflict: 'phone' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const token = jwt.sign({ id: data.id, phone: data.phone, role: data.role || 'customer' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: data.id, phone: data.phone, name: data.name, role: data.role || 'customer' } });
  } catch (e) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==================== PRODUCTS ====================

app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Product not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.post('/api/products', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, description, price, old_price, stock, image_urls, category_id } = req.body;
    const { data, error } = await supabase.from('products').insert({ name, description, price, old_price, stock, image_urls, category_id }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create product' });
  }
});

app.put('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Product deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ==================== ORDERS ====================

app.post('/api/orders', authMiddleware, async (req, res) => {
  try {
    const { items, customer_address, order_notes } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Items required' });

    const subtotal = calcTotal(items);
    const { method, amountPaid, amountDue, status } = determinePayment(subtotal);
    const orderNumber = generateOrderNumber();

    const orderData = {
      order_number: orderNumber,
      customer_id: req.user.id,
      customer_phone: req.user.phone,
      customer_name: req.user.name,
      subtotal,
      total: subtotal,
      payment_method: method,
      delivery_address: customer_address,
      delivery_note: order_notes,
      status: 'pending'
    };

    const { data: order, error: orderErr } = await supabase.from('orders').insert(orderData).select().single();
    if (orderErr) return res.status(500).json({ error: orderErr.message });

    const orderItems = items.map(i => ({
      order_id: order.id,
      product_id: i.id,
      product_name: i.name,
      product_image: i.image_urls,
      quantity: i.quantity,
      price: i.price
    }));

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    res.status(201).json({ ...order, items: orderItems });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    if (req.user.role !== 'admin') {
      query = query.eq('customer_id', req.user.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('orders').select('*, order_items(*)').eq('id', req.params.id);
    if (req.user.role !== 'admin') {
      query = query.eq('customer_id', req.user.id);
    }
    const { data, error } = await query.single();
    if (error) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

app.patch('/api/orders/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const { data, error } = await supabase.from('orders').update({ status }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// ==================== PAYMENTS ====================

app.post('/api/payments', authMiddleware, async (req, res) => {
  try {
    const { order_id, amount, method, reference } = req.body;
    const { data, error } = await supabase.from('payments').insert({
      order_id, amount, method, reference, status: 'pending', user_id: req.user.id
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: 'Payment request failed' });
  }
});

app.get('/api/payments', authMiddleware, async (req, res) => {
  try {
    let query = supabase.from('payments').select('*, orders(order_number, customer_name)').order('created_at', { ascending: false });
    if (req.user.role !== 'admin') {
      query = query.eq('user_id', req.user.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

app.patch('/api/payments/:id/confirm', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: payment, error: pErr } = await supabase.from('payments').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', id).select().single();
    if (pErr) return res.status(500).json({ error: pErr.message });

    const { error: oErr } = await supabase.from('orders').update({
      payment_status: 'confirmed',
      amount_paid: payment.amount,
      status: 'confirmed'
    }).eq('id', payment.order_id);

    res.json({ payment, order_updated: !oErr });
  } catch (e) {
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

app.patch('/api/payments/:id/reject', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('payments').update({ status: 'rejected' }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// ==================== PROFILE ====================

app.patch('/api/profile', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const { data, error } = await supabase.from('profiles').update({ name }).eq('id', req.user.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== CONFIG ====================

app.get('/api/config', async (req, res) => {
  try {
    const { data, error } = await supabase.from('config').select('*');
    if (error) return res.status(500).json({ error: error.message });
    const config = {};
    (data || []).forEach(c => { config[c.key] = c.value; });
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ==================== DASHBOARD ====================

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const { data: products, error: pErr } = await supabase.from('products').select('id').eq('is_active', true);
    const { data: orders, error: oErr } = await supabase.from('orders').select('id,total,status,created_at');
    if (pErr) return res.status(500).json({ error: pErr.message });
    if (oErr) return res.status(500).json({ error: oErr.message });
    const totalRevenue = (orders || []).filter(o => o.status === 'confirmed').reduce((s, o) => s + (o.total || 0), 0);
    res.json({
      totalProducts: products ? products.length : 0,
      totalOrders: orders ? orders.length : 0,
      pendingOrders: orders ? orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length : 0,
      totalRevenue
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Jefram Bot server running on port ${PORT}`);
});
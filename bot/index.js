require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER || '256748632752';

const client = new Client({ 
    authStrategy: new LocalAuth({ 
        clientId: 'jefram-bot-client'
    }), 
    puppeteer: { 
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--user-data-dir=C:\\Users\\Jefram\\Desktop\\jefram-bot\\chrome-profile', '--start-maximized', '--disable-infobars', '--disable-extensions'],
        defaultViewport: null
    } 
});

const productCache = new Map();

async function refreshProducts() {
    try {
        const { data } = await axios.get(`${API_URL}/api/products`);
        productCache.clear();
        data.forEach(p => productCache.set(p.id, p));
        return data;
    } catch (e) { return []; }
}

function formatPrice(p) { return (p || 0).toLocaleString('en-US', { style:'currency', currency:'UGX', minimumFractionDigits:0 }); }

function buildCatalogMessage(products) {
    let msg = '*🛍️ Jefram Stores Catalog*\n\n';
    products.forEach((p, i) => { msg += `${i+1}. *${p.name}* — ${formatPrice(p.price)}\n`; });
    msg += '\nReply with the item number to order.';
    return msg;
}

client.on('ready', async () => {
    console.log('WhatsApp bot is ready!');
    console.log('Bot is authenticated and connected to WhatsApp');
    await refreshProducts();
});

client.on('qr', (qr) => {
    console.log('QR Code received! Scan this with your WhatsApp:');
    console.log(qr);
});

client.on('authenticated', () => {
    console.log('WhatsApp bot authenticated successfully!');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
});

client.on('message', async (message) => {
    const chat = await message.getChat();
    const from = message.from;
    const body = message.body.trim();
    const isGroup = chat.type === 'group';
    if (isGroup) return;
    const isAdmin = from === ADMIN_PHONE;
    const lower = body.toLowerCase();

    if (lower === 'catalog' || lower === 'products' || lower === 'menu') {
        const products = await refreshProducts();
        chat.sendMessage(buildCatalogMessage(products));
    }
    else if (lower.startsWith('order') || /^\d+/.test(body)) {
        const nums = body.match(/\d+/g);
        if (!nums) return;
        const items = [];
        let total = 0;
        const products = await refreshProducts();
        for (const num of nums) {
            const idx = parseInt(num) - 1;
            const product = products[idx];
            if (product && product.stock > 0) { items.push(product); total += product.price; }
        }
        if (!items.length) { chat.sendMessage('No valid items selected.'); return; }
        let msg = '*📋 Order Summary:*\n';
        items.forEach((p, i) => { msg += `${i+1}. ${p.name} — ${formatPrice(p.price)}\n`; });
        msg += `\n*Total: ${formatPrice(total)}*\n\n`;
        if (total >= 100000) msg += 'Payment: 50% online now, 50% on delivery.\n';
        else msg += 'Payment: Full payment online.\n';
        msg += '\nReply with your delivery address to confirm order.';
        const orderMsg = await chat.sendMessage(msg);
        const collector = await chat.createMessageCollector({ messageFilter: m => m.from === from, max: 1, time: 300000 });
        collector.on('collect', async (reply) => {
            const address = reply.body;
            const itemsData = items.map(p => ({ name: p.name, price: p.price, quantity: 1 }));
            try {
                const { data } = await axios.post(`${API_URL}/api/orders`, { items: itemsData, customer_address: address, payment_method: total >= 100000 ? 'half_half' : 'online' }, { headers: { 'Content-Type': 'application/json' } });
                await chat.sendMessage(`✅ *Order Placed!*\nOrder #: ${data.order_number}\nTotal: ${formatPrice(data.total)}\nStatus: ${data.status}`);
                if (isAdmin) { await chat.sendMessage(`📦 New order from ${from}: ${data.order_number} — ${formatPrice(data.total)}`); }
            } catch (e) { chat.sendMessage('❌ Failed to place order. Try again.'); }
        });
        collector.on('end', () => orderMsg.react('⏰'));
    }
    else if (isAdmin && lower === 'orders') {
        try {
            const adminToken = process.env.ADMIN_TOKEN || '';
            const { data } = await axios.get(`${API_URL}/api/orders`, { headers: { Authorization: `Bearer ${adminToken}` } });
            let msg = '*📦 Orders:*\n';
            data.forEach(o => { msg += `${o.order_number}: ${formatPrice(o.total)} [${o.status}] — ${o.payment_method}\n`; });
            chat.sendMessage(msg || 'No orders.');
        } catch (e) { chat.sendMessage('Could not fetch orders.'); }
    }
    else if (isAdmin && lower === 'status') {
        await refreshProducts();
        chat.sendMessage('✅ Bot connected and synced.');
    }
});

client.initialize();
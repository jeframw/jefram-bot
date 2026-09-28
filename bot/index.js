require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_PHONE_RAW = process.env.ADMIN_PHONE_NUMBER || '256748632752';
const ADMIN_PHONE = ADMIN_PHONE_RAW.replace(/\D/g, '');
const BOT_TOKEN = process.env.WHATSAPP_BOT_TOKEN || 'your_whatsapp_bot_token';
const STORE_URL = process.env.STORE_URL || 'http://localhost:3000';

const MTN_NUMBER = process.env.MTN_MONEY_NUMBER || '0771234567';
const MTN_NAME = process.env.MTN_MONEY_NAME || 'Jefram Stores';
const AIRTEL_NUMBER = process.env.AIRTEL_MONEY_NUMBER || '0752345678';
const AIRTEL_NAME = process.env.AIRTEL_MONEY_NAME || 'Jefram Stores';

// ──────────────────────────────────────────────────────────────────
//  Session state machine
//  Each session: { step, orderId, orderNumber, total, timer, items }
//  Steps:
//    'awaiting_payment_method'  – waiting for MTN / AIRTEL choice
//    'awaiting_paid'            – payment number revealed, waiting for PAID
//    'awaiting_track'           – admin must confirm funds first
// ──────────────────────────────────────────────────────────────────
const userSessions = new Map();
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function setSession(phone, data) {
    const existing = userSessions.get(phone);
    if (existing && existing.timer) clearTimeout(existing.timer);
    data.timer = setTimeout(() => {
        userSessions.delete(phone);
    }, SESSION_TIMEOUT_MS);
    userSessions.set(phone, data);
}

function clearSession(phone) {
    const s = userSessions.get(phone);
    if (s && s.timer) clearTimeout(s.timer);
    userSessions.delete(phone);
}

// ──────────────────────────────────────────────────────────────────
//  Chrome detection
// ──────────────────────────────────────────────────────────────────
function getChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    // Railway/Linux paths
    const linuxPaths = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ];
    
    // Windows paths
    const windowsPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    
    const standardPaths = process.platform === 'win32' ? windowsPaths : linuxPaths;
    
    for (const p of standardPaths) {
        if (p && fs.existsSync(p)) return p;
    }
    return undefined;
}

const chromePath = getChromeExecutablePath();
const puppeteerOptions = {
    headless: process.env.NODE_ENV === 'production' ? 'new' : false,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer'
    ]
};
if (chromePath) puppeteerOptions.executablePath = chromePath;

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'jefram-bot-client',
        dataPath: path.join(__dirname, '..', '.wwebjs_auth')
    }),
    puppeteer: puppeteerOptions
});

// ──────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────
function formatPrice(p) {
    return (p || 0).toLocaleString('en-US', { style: 'currency', currency: 'UGX', minimumFractionDigits: 0 });
}

async function sendMsg(chatId, text) {
    try {
        await client.sendMessage(chatId, text);
    } catch (e) {
        console.error('sendMsg error:', e.message);
    }
}

async function notifyAdmin(text) {
    try {
        await client.sendMessage(`${ADMIN_PHONE}@c.us`, text);
    } catch (e) {
        console.warn('Admin notify error:', e.message);
    }
}

function normalizePhone(raw) {
    return raw.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
}

function isAdminPhone(phone) {
    const c = normalizePhone(phone);
    return c === ADMIN_PHONE ||
        (c.length >= 9 && ADMIN_PHONE.endsWith(c)) ||
        (ADMIN_PHONE.length >= 9 && c.endsWith(ADMIN_PHONE));
}

// ──────────────────────────────────────────────────────────────────
//  Welcome & menu
// ──────────────────────────────────────────────────────────────────
async function sendWelcome(chatId, isAdmin) {
    let msg = `👋 *Welcome to Jefram Stores!*\n\n`;
    msg += `Choose an option below:\n\n`;
    msg += `🛍️ *1* — See Items (Shop online)\n`;
    msg += `📦 *2* — See My Orders\n`;
    if (isAdmin) {
        msg += `\n👑 *Admin commands:*\n`;
        msg += `• *orders* — View all recent orders\n`;
        msg += `• *status* — Bot system status\n`;
        msg += `• *confirm ORDER_NUMBER* — Confirm payment received\n`;
    }
    msg += `\nReply *1* or *2* to continue.`;
    await sendMsg(chatId, msg);
}

// ──────────────────────────────────────────────────────────────────
//  Parse ORDER message from WhatsApp deeplink
//  Format: ORDER\n1. Item x1 - UGX 5,000\n...\nTotal: UGX 15,000
//  Or:     PLACE_ORDER|item1,qty1,price1|item2,qty2,price2|...|total
// ──────────────────────────────────────────────────────────────────
function parseOrderMessage(body) {
    // New compact format from client: PLACE_ORDER|name:qty:price|...|TOTAL:amount
    if (body.startsWith('PLACE_ORDER|')) {
        const parts = body.split('|');
        const items = [];
        let total = 0;
        for (let i = 1; i < parts.length; i++) {
            const p = parts[i];
            if (p.startsWith('TOTAL:')) {
                total = parseFloat(p.replace('TOTAL:', '')) || 0;
                continue;
            }
            const [name, qty, price] = p.split(':');
            if (name && qty && price) {
                items.push({ name: decodeURIComponent(name), quantity: parseInt(qty) || 1, price: parseFloat(price) || 0 });
            }
        }
        if (!total && items.length) total = items.reduce((s, i) => s + i.price * i.quantity, 0);
        return items.length ? { items, total } : null;
    }

    // Legacy human-readable ORDER format
    if (!body.toUpperCase().startsWith('ORDER')) return null;
    const lines = body.split('\n').slice(1); // skip "ORDER" header
    const items = [];
    let total = 0;
    for (const line of lines) {
        const totalMatch = line.match(/total[:\s]+ugx[\s]*([\d,]+)/i);
        if (totalMatch) {
            total = parseFloat(totalMatch[1].replace(/,/g, '')) || 0;
            continue;
        }
        const itemMatch = line.match(/\d+\.\s+(.+?)\s+x(\d+)\s*[-–]\s*ugx[\s]*([\d,]+)/i);
        if (itemMatch) {
            items.push({
                name: itemMatch[1].trim(),
                quantity: parseInt(itemMatch[2]) || 1,
                price: parseFloat(itemMatch[3].replace(/,/g, '')) || 0
            });
        }
    }
    if (!total && items.length) total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    return items.length ? { items, total } : null;
}

// ──────────────────────────────────────────────────────────────────
//  Create order in DB
// ──────────────────────────────────────────────────────────────────
async function createOrder(cleanPhone, customerName, items, total) {
    const payload = {
        customer_phone: cleanPhone,
        customer_name: customerName || 'WhatsApp Customer',
        customer_address: 'To be confirmed via WhatsApp',
        delivery_address: 'To be confirmed via WhatsApp',
        items: items.map(i => ({
            id: i.id || null,
            name: i.name,
            price: i.price,
            quantity: i.quantity || 1,
            image_url: i.image_url || null
        })),
        payment_method: 'online',
        order_notes: 'Order via WhatsApp bot'
    };
    const { data } = await axios.post(`${API_URL}/api/bot/orders`, payload, {
        headers: { 'Content-Type': 'application/json', 'x-bot-token': BOT_TOKEN },
        timeout: 12000
    });
    return data;
}

// ──────────────────────────────────────────────────────────────────
//  Payment flow messages
// ──────────────────────────────────────────────────────────────────
async function sendPaymentChoiceMessage(chatId, orderNumber, total) {
    let msg = `✅ *Order Received!* 🎉\n\n`;
    msg += `📦 *Order #:* ${orderNumber}\n`;
    msg += `💰 *Total:* ${formatPrice(total)}\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💳 *Payment Required*\n`;
    msg += `All payments are made via Mobile Money.\n\n`;
    msg += `Please choose your payment method:\n\n`;
    msg += `*1* — 📱 MTN Mobile Money\n`;
    msg += `*2* — 📱 Airtel Money\n\n`;
    msg += `Reply *1* or *2* to see payment details.`;
    await sendMsg(chatId, msg);
}

async function sendMTNDetails(chatId, orderNumber, total) {
    let msg = `📱 *MTN Mobile Money Payment*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *Order #:* ${orderNumber}\n`;
    msg += `💰 *Amount to Send:* ${formatPrice(total)}\n\n`;
    msg += `📲 *Send to:*\n`;
    msg += `   Number: *${MTN_NUMBER}*\n`;
    msg += `   Name: *${MTN_NAME}*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `*Steps:*\n`;
    msg += `1️⃣ Dial *165# or open MTN MoMo app\n`;
    msg += `2️⃣ Select "Send Money"\n`;
    msg += `3️⃣ Enter the number: *${MTN_NUMBER}*\n`;
    msg += `4️⃣ Enter Amount: ${formatPrice(total)}\n`;
    msg += `5️⃣ Complete the transaction\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `After paying, reply *PAID* to notify us! ✅`;
    await sendMsg(chatId, msg);
}

async function sendAirtelDetails(chatId, orderNumber, total) {
    let msg = `📱 *Airtel Money Payment*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *Order #:* ${orderNumber}\n`;
    msg += `💰 *Amount to Send:* ${formatPrice(total)}\n\n`;
    msg += `📲 *Send to:*\n`;
    msg += `   Number: *${AIRTEL_NUMBER}*\n`;
    msg += `   Name: *${AIRTEL_NAME}*\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `*Steps:*\n`;
    msg += `1️⃣ Dial *185# or open Airtel Money app\n`;
    msg += `2️⃣ Select "Send Money"\n`;
    msg += `3️⃣ Enter the number: *${AIRTEL_NUMBER}*\n`;
    msg += `4️⃣ Enter Amount: ${formatPrice(total)}\n`;
    msg += `5️⃣ Complete the transaction\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `After paying, reply *PAID* to notify us! ✅`;
    await sendMsg(chatId, msg);
}

// ──────────────────────────────────────────────────────────────────
//  Bot events
// ──────────────────────────────────────────────────────────────────
client.on('ready', async () => {
    const myNumber = client.info && client.info.wid ? client.info.wid.user : 'Unknown';
    const myName = client.info ? client.info.pushname || '' : '';
    console.log(`✅ WhatsApp bot is ready!`);
    console.log(`📱 Connected: +${myNumber} (${myName})`);
    console.log(`👑 Admin: +${ADMIN_PHONE}`);
    console.log(`🏪 Store URL: ${STORE_URL}`);
    console.log(`💳 MTN: ${MTN_NUMBER} | Airtel: ${AIRTEL_NUMBER}`);
});

client.on('qr', (qr) => {
    console.log('\n📲 Scan this QR code with your WhatsApp:');
    try { require('qrcode-terminal').generate(qr, { small: true }); } catch (e) { console.log(qr); }
});

client.on('authenticated', () => console.log('🔐 Authenticated!'));
client.on('auth_failure', (msg) => console.error('❌ Auth failed:', msg));

client.on('message_create', async (message) => {
    try {
        const botUserNumber = client.info && client.info.wid ? client.info.wid.user : '';

        // Only process self-chat (bot testing itself) or incoming messages from others
        if (message.fromMe) {
            const isSelf = message.to === message.from || (botUserNumber && message.to.includes(botUserNumber));
            if (!isSelf) return;
        }

        // Skip group messages
        if (message.from.endsWith('@g.us') || (message.to && message.to.endsWith('@g.us'))) return;

        const chatId = message.fromMe ? message.to : message.from;
        const body = (message.body || '').trim();
        if (!body) return;

        const cleanFrom = normalizePhone(chatId);
        const isAdmin = isAdminPhone(cleanFrom);
        const lower = body.toLowerCase();

        console.log(`📩 [${isAdmin ? 'ADMIN' : 'USER'}] ${cleanFrom}: "${body.substring(0, 80)}"`);

        // ─── ADMIN COMMANDS ───────────────────────────────────────
        if (isAdmin) {
            // confirm ORDER_NUMBER
            if (lower.startsWith('confirm ')) {
                const orderNum = body.replace(/confirm\s+/i, '').trim().toUpperCase();
                await handleAdminConfirm(chatId, orderNum);
                return;
            }
            if (lower === 'orders') {
                await handleAdminOrders(chatId);
                return;
            }
            if (lower === 'status') {
                await handleAdminStatus(chatId);
                return;
            }
        }

        // ─── SESSION STATE MACHINE ────────────────────────────────
        if (userSessions.has(cleanFrom)) {
            const session = userSessions.get(cleanFrom);

            if (lower === 'cancel' || lower === 'stop') {
                clearSession(cleanFrom);
                await sendMsg(chatId, '❌ Session cancelled. Send *hi* to start again.');
                return;
            }

            // Step: awaiting payment method (1=MTN, 2=Airtel)
            if (session.step === 'awaiting_payment_method') {
                if (body === '1' || lower.includes('mtn')) {
                    setSession(cleanFrom, { ...session, step: 'awaiting_paid', paymentMethod: 'MTN' });
                    await sendMTNDetails(chatId, session.orderNumber, session.total);
                    return;
                }
                if (body === '2' || lower.includes('airtel')) {
                    setSession(cleanFrom, { ...session, step: 'awaiting_paid', paymentMethod: 'Airtel' });
                    await sendAirtelDetails(chatId, session.orderNumber, session.total);
                    return;
                }
                await sendMsg(chatId, `Please reply *1* for MTN or *2* for Airtel Money.`);
                return;
            }

            // Step: awaiting PAID confirmation from customer
            if (session.step === 'awaiting_paid') {
                if (lower === 'paid' || lower === '✅ paid' || lower === 'i have paid' || lower === 'done') {
                    // Record payment claim in DB
                    try {
                        await axios.post(`${API_URL}/api/payments`, {
                            order_id: session.orderId,
                            amount: session.total,
                            method: 'mobile_money',
                            reference: `${session.paymentMethod} - Customer claimed payment`
                        }, {
                            headers: { 'x-bot-token': BOT_TOKEN },
                            timeout: 8000
                        });
                    } catch (e) {
                        console.warn('Payment record warning:', e.message);
                    }

                    // Notify admin
                    let adminMsg = `💰 *Payment Claimed!*\n\n`;
                    adminMsg += `📦 *Order #:* ${session.orderNumber}\n`;
                    adminMsg += `💳 *Method:* ${session.paymentMethod}\n`;
                    adminMsg += `💰 *Amount:* ${formatPrice(session.total)}\n`;
                    adminMsg += `📱 *Customer:* +${cleanFrom}\n\n`;
                    adminMsg += `Please check your ${session.paymentMethod} account.\n`;
                    adminMsg += `When confirmed, reply:\n`;
                    adminMsg += `*confirm ${session.orderNumber}*`;
                    await notifyAdmin(adminMsg);

                    // Tell customer to wait
                    let waitMsg = `⏳ *Payment Received! Awaiting Confirmation...*\n\n`;
                    waitMsg += `📦 *Order #:* ${session.orderNumber}\n`;
                    waitMsg += `💳 *Payment Method:* ${session.paymentMethod}\n`;
                    waitMsg += `💰 *Amount:* ${formatPrice(session.total)}\n\n`;
                    waitMsg += `✅ We've notified the admin. Your order will be confirmed once the payment is verified.\n\n`;
                    waitMsg += `Thank you for shopping with *Jefram Stores*! 🙏`;
                    await sendMsg(chatId, waitMsg);

                    setSession(cleanFrom, { ...session, step: 'awaiting_track' });
                    return;
                }
                // Resend payment details if they type something else
                await sendMsg(chatId, `Please complete the payment and then reply *PAID* when done.\n\nOr reply *cancel* to cancel.`);
                return;
            }

            // Step: awaiting admin track confirmation
            if (session.step === 'awaiting_track') {
                await sendMsg(chatId, `⏳ Your payment is still being verified. Please wait for admin confirmation.\n\nOrder #: *${session.orderNumber}*`);
                return;
            }
        }

        // ─── WELCOME / MAIN MENU ──────────────────────────────────
        if (lower === 'hi' || lower === 'hello' || lower === 'start' || lower === 'help' || lower === 'menu') {
            await sendWelcome(chatId, isAdmin);
            return;
        }

        // ─── MAIN MENU: 1 = See Items ─────────────────────────────
        if (body === '1') {
            let msg = `🛍️ *Jefram Stores — Shop Online*\n\n`;
            msg += `Browse our products and add items to your cart!\n\n`;
            msg += `🔗 *Click here to shop:*\n${STORE_URL}\n\n`;
            msg += `When you're ready, click *Make Order* in your cart and the order will be sent here automatically. 📲`;
            await sendMsg(chatId, msg);
            return;
        }

        // ─── MAIN MENU: 2 = See Orders ───────────────────────────
        if (body === '2') {
            await handleSeeOrders(chatId, cleanFrom);
            return;
        }

        // ─── ORDER from client website (PLACE_ORDER or ORDER) ─────
        if (body.startsWith('PLACE_ORDER|') || body.toUpperCase().startsWith('ORDER')) {
            const parsed = parseOrderMessage(body);
            if (!parsed || !parsed.items || !parsed.items.length) {
                await sendMsg(chatId, `⚠️ Could not read your order. Please try again from the website.`);
                return;
            }

            await sendMsg(chatId, `⏳ Processing your order...`);

            let customerName = 'WhatsApp Customer';
            try {
                const contact = await message.getContact();
                customerName = contact.pushname || contact.name || 'WhatsApp Customer';
            } catch (e) {}

            try {
                const order = await createOrder(cleanFrom, customerName, parsed.items, parsed.total);

                // Notify admin
                let adminAlert = `🚨 *New Order!*\n\n`;
                adminAlert += `📦 *Order #:* ${order.order_number}\n`;
                adminAlert += `👤 *Customer:* ${customerName} (+${cleanFrom})\n`;
                adminAlert += `💰 *Total:* ${formatPrice(order.total)}\n`;
                adminAlert += `\n*Items:*\n`;
                parsed.items.forEach((item, idx) => {
                    adminAlert += `${idx + 1}. ${item.name} x${item.quantity} — ${formatPrice(item.price * item.quantity)}\n`;
                });
                await notifyAdmin(adminAlert);

                // Set session for payment flow
                setSession(cleanFrom, {
                    step: 'awaiting_payment_method',
                    orderId: order.id,
                    orderNumber: order.order_number,
                    total: order.total,
                    items: parsed.items
                });

                await sendPaymentChoiceMessage(chatId, order.order_number, order.total);
            } catch (err) {
                console.error('Order error:', err.response ? err.response.data : err.message);
                await sendMsg(chatId, `❌ Failed to create your order. Please try again.\n\n(Error: ${err.message})`);
            }
            return;
        }

        // ─── CATALOG (legacy command support) ────────────────────
        if (lower === 'catalog' || lower === 'products' || lower === 'items') {
            let msg = `🛍️ Browse our full catalog online:\n${STORE_URL}\n\nSend *1* for quick access or visit the link above.`;
            await sendMsg(chatId, msg);
            return;
        }

        // ─── DEFAULT: show welcome ────────────────────────────────
        await sendWelcome(chatId, isAdmin);

    } catch (handlerErr) {
        console.error('Error handling message:', handlerErr);
    }
});

// ──────────────────────────────────────────────────────────────────
//  See orders for customer
// ──────────────────────────────────────────────────────────────────
async function handleSeeOrders(chatId, cleanPhone) {
    try {
        const { data: orders } = await axios.get(`${API_URL}/api/orders`, {
            headers: { 'x-bot-token': BOT_TOKEN },
            timeout: 8000,
            params: { phone: cleanPhone }
        });

        const myOrders = (orders || []).filter(o => o.customer_phone === cleanPhone);

        if (!myOrders.length) {
            await sendMsg(chatId, `📦 *Your Orders*\n\nYou have no orders yet.\n\nShop now: ${STORE_URL}`);
            return;
        }

        const pending = myOrders.filter(o => !['delivered', 'cancelled'].includes(o.status));
        const finished = myOrders.filter(o => ['delivered', 'cancelled'].includes(o.status));

        let msg = `📦 *Your Orders*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (pending.length) {
            msg += `🔄 *Pending/Active (${pending.length}):*\n`;
            pending.slice(0, 5).forEach(o => {
                msg += `• *${o.order_number}* — ${formatPrice(o.total)}\n`;
                msg += `  Status: *${o.status.toUpperCase()}*`;
                msg += ` | Payment: *${o.payment_status || 'pending'}*\n`;
            });
            msg += `\n`;
        }

        if (finished.length) {
            msg += `✅ *Completed (${finished.length}):*\n`;
            finished.slice(0, 5).forEach(o => {
                msg += `• *${o.order_number}* — ${formatPrice(o.total)} [${o.status.toUpperCase()}]\n`;
            });
        }

        msg += `\nSend *hi* to go back to the main menu.`;
        await sendMsg(chatId, msg);
    } catch (e) {
        console.error('See orders error:', e.message);
        await sendMsg(chatId, `❌ Could not fetch your orders. Please try again later.`);
    }
}

// ──────────────────────────────────────────────────────────────────
//  Admin: confirm payment received → send track order to customer
// ──────────────────────────────────────────────────────────────────
async function handleAdminConfirm(adminChatId, orderNumber) {
    try {
        // Get order by order_number
        const { data: orders } = await axios.get(`${API_URL}/api/orders`, {
            headers: { 'x-bot-token': BOT_TOKEN },
            timeout: 8000
        });
        const order = (orders || []).find(o => o.order_number === orderNumber);
        if (!order) {
            await sendMsg(adminChatId, `❌ Order *${orderNumber}* not found.`);
            return;
        }

        // Find pending payment for this order
        let paymentId = null;
        try {
            const { data: payments } = await axios.get(`${API_URL}/api/payments`, {
                headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN || ''}`, 'x-bot-token': BOT_TOKEN },
                timeout: 8000
            });
            const payment = (payments || []).find(p => p.order_id === order.id && p.status === 'pending');
            if (payment) paymentId = payment.id;
        } catch (e) {
            console.warn('Payment lookup warn:', e.message);
        }

        // Confirm payment via API
        if (paymentId) {
            try {
                await axios.patch(`${API_URL}/api/payments/${paymentId}/confirm`, {}, {
                    headers: { 'x-bot-token': BOT_TOKEN },
                    timeout: 8000
                });
            } catch (e) {
                console.warn('Payment confirm API warn:', e.message);
            }
        } else {
            // Update order status directly
            try {
                await axios.patch(`${API_URL}/api/orders/${order.id}/status`, { status: 'confirmed', payment_status: 'confirmed' }, {
                    headers: { 'x-bot-token': BOT_TOKEN },
                    timeout: 8000
                });
            } catch (e) {
                console.warn('Order status update warn:', e.message);
            }
        }

        // Send track order message to customer
        const customerChatId = `${order.customer_phone}@c.us`;
        let trackMsg = `🎉 *Payment Confirmed!*\n\n`;
        trackMsg += `📦 *Order #:* ${order.order_number}\n`;
        trackMsg += `💰 *Amount:* ${formatPrice(order.total)}\n\n`;
        trackMsg += `✅ Your payment has been received and verified!\n`;
        trackMsg += `Your order is now being prepared.\n\n`;
        trackMsg += `📍 *Track Your Order:*\n`;
        trackMsg += `Order Status: *CONFIRMED — Being Prepared*\n\n`;
        trackMsg += `We'll notify you when your order is on its way! 🚀\n\n`;
        trackMsg += `Thank you for shopping with *Jefram Stores*! 🙏`;

        await sendMsg(customerChatId, trackMsg);

        // Clear the customer's session if they were waiting
        const cleanCustomerPhone = normalizePhone(customerChatId);
        clearSession(cleanCustomerPhone);

        // Reply to admin
        await sendMsg(adminChatId, `✅ Payment for *${orderNumber}* confirmed!\n\nCustomer (+${order.customer_phone}) has been notified. 📱`);

    } catch (e) {
        console.error('Admin confirm error:', e.message);
        await sendMsg(adminChatId, `❌ Error confirming order: ${e.message}`);
    }
}

// ──────────────────────────────────────────────────────────────────
//  Admin: see all orders
// ──────────────────────────────────────────────────────────────────
async function handleAdminOrders(chatId) {
    try {
        const { data } = await axios.get(`${API_URL}/api/orders`, {
            headers: { 'x-bot-token': BOT_TOKEN },
            timeout: 8000
        });
        if (!data || !data.length) {
            await sendMsg(chatId, `📦 No orders found.`);
            return;
        }
        let msg = `*📦 Recent Orders (${data.length}):*\n━━━━━━━━━━━━━━━━━━━━\n`;
        data.slice(0, 10).forEach(o => {
            msg += `• *${o.order_number}* — ${formatPrice(o.total)}\n`;
            msg += `  Status: [${o.status.toUpperCase()}] | Pay: ${o.payment_status || 'pending'}\n`;
            msg += `  📱 +${o.customer_phone}\n\n`;
        });
        msg += `To confirm payment: *confirm ORDER_NUMBER*`;
        await sendMsg(chatId, msg);
    } catch (e) {
        await sendMsg(chatId, `❌ Could not fetch orders: ${e.message}`);
    }
}

// ──────────────────────────────────────────────────────────────────
//  Admin: status
// ──────────────────────────────────────────────────────────────────
async function handleAdminStatus(chatId) {
    let msg = `✅ *Bot System Status:*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `• WhatsApp: Connected\n`;
    msg += `• Backend: ${API_URL}\n`;
    msg += `• Store URL: ${STORE_URL}\n`;
    msg += `• MTN: ${MTN_NUMBER}\n`;
    msg += `• Airtel: ${AIRTEL_NUMBER}\n`;
    msg += `• Active Sessions: ${userSessions.size}\n`;
    msg += `• Admin: +${ADMIN_PHONE}\n`;
    await sendMsg(chatId, msg);
}

client.initialize();